const test = require('node:test');
const assert = require('node:assert/strict');
const {normalizeUpdate, validateCart, callbackResult, attachDialogue, vagueReply} = require('./core.cjs');
const catalog = require('./catalog.demo.json');
const config = {allowedChatIds:'100000001',botId:'200000002',catalog};
const message = x => ({message:{chat:{id:100000001,type:'private'},from:{id:100000001},message_id:1,...x}});
const extract = items => ({items,uncertain:false});
const line = (product,quantity,unit='') => ({product,quantity,unit});
const cart = items => validateCart(extract(items),{text:'test',source:'text'},catalog);
test('RU text and Telegram voice/audio/document route',()=>{
  assert.equal(normalizeUpdate(message({text:'Кофе два'}),config).route,'text');
  for(const field of ['voice','audio','document']) assert.equal(normalizeUpdate(message({[field]:{file_id:'fixture',file_name:'voice.ogg',mime_type:'audio/ogg',file_size:1000}}),config).route,'audio');
});
test('deny wrong owner, groups and bot messages',()=>{
  for(const m of [{chat:{id:1,type:'private'},from:{id:1}},{chat:{id:100000001,type:'group'},from:{id:100000001}},{from:{id:100000001,is_bot:true}}]) assert.equal(normalizeUpdate(message(m),config),null);
  assert.equal(normalizeUpdate(message({text:'test'}),{...config,allowedChatIds:''}),null);
});
test('help and catalog never parsed as orders',()=>{
  for(const text of ['/start','/help','/example','/пример','/catalog','/start@VoiceOrDeer_bot']) assert.equal(normalizeUpdate(message({text}),config).route,'help');
});
test('oversized text/audio rejected before paid services',()=>{
  assert.equal(normalizeUpdate(message({text:'a'.repeat(4001)}),config).route,'help');
  assert.equal(normalizeUpdate(message({voice:{file_id:'x',file_size:20*1024*1024}}),config).route,'help');
});
test('catalog prices, exact total and ignored injected price',()=>{
  const x=cart([{...line('кофе',2),price:1},line('сахар',3)]);
  assert.equal(x.valid,true); assert.equal(x.total,6450); assert.equal(x.rows[0].price,2400);
});
test('Kazakh aliases supported',()=>{
  const x=cart([line('ұнтақталған кофе',2,'қаптама'),line('қант',3,'қаптама')]);
  assert.equal(x.valid,true); assert.equal(x.total,6450);
});
test('ambiguous tea and unknown products blocked',()=>{
  assert.equal(cart([line('чай',2)]).valid,false);
  assert.equal(cart([line('кока-кола',2)]).valid,false);
});
test('missing, string, fractional, negative, infinite and huge quantity blocked',()=>{
  for(const q of [null,undefined,'2',0,-1,1.5,Infinity,1001]) assert.equal(cart([line('кофе',q)]).valid,false);
});
test('unit conversion uses only explicit catalog pack sizes',()=>{
  assert.equal(cart([line('сахар',3,'кг')]).rows[0].quantity,3);
  assert.equal(cart([line('вода',3,'литр')]).rows[0].quantity,3);
  assert.equal(cart([line('вода',3,'бутылка')]).valid,true);
  assert.equal(validateCart(extract([line('сахар',3,'кг')]),{},catalog.map(p=>({...p,packSize:undefined}))).valid,false);
});
test('duplicate lines merged without rounding errors and maximum enforced',()=>{
  assert.equal(cart([line('кофе',2),line('кофе',3)]).rows[0].quantity,5);
  assert.equal(cart([line('кофе',1000),line('кофе',1)]).valid,false);
});
test('uncertain and empty extraction fail closed',()=>{
  assert.equal(validateCart({items:[line('кофе',2)],uncertain:true},{},catalog).valid,false);
  assert.equal(cart([]).valid,false);
});
test('audio clarification includes transcript',()=>{
  const x=validateCart(extract([line('чай',2)]),{text:'Две упаковки чая',source:'audio'},catalog);
  assert.match(x.preview,/Распознано: Две упаковки чая/); assert.equal(x.valid,false);
});
test('native callbacks bound to owner and original message',()=>{
  const q={callback_query:{id:'q1',data:'vo:a:VO-test',from:{id:100000001},message:{message_id:9,chat:{id:100000001,type:'private'}}}};
  const x=normalizeUpdate(q,config); assert.equal(x.route,'callback'); assert.equal(x.action,'a'); assert.equal(x.previewMessageId,'9');
  q.callback_query.from.id=1; assert.equal(normalizeUpdate(q,config),null);
});
test('only row changed by this execution accepted; replay and wrong message rejected',()=>{
  const ctx={token:'VO-test',chatId:'100000001',previewMessageId:'9'};
  const r={...ctx,telegramMessageId:'9',claimExecutionId:'run1',status:'confirmed',payload:JSON.stringify({preview:'ДЕМО'})};
  assert.equal(callbackResult([r],ctx,'run1').available,true);
  assert.equal(callbackResult([r],ctx,'run2').available,false);
  assert.equal(callbackResult([r],{...ctx,previewMessageId:'10'},'run1').available,false);
  assert.equal(callbackResult([],ctx,'run1').available,false);
});
test('actual spoken sizes map to catalog and all prices shown',()=>{
  const x=cart([line('кофе молотый 250 граммов',2,'упаковка'),line('чай зеленый 100 грамм',5,'упаковка'),line('сахар 1 килограмм',7,'упаковка')]);
  assert.equal(x.valid,true); assert.equal(x.total,14150);
  assert.deepEqual(x.rows.map(p=>p.quantity),[2,5,7]);
  assert.match(x.preview,/Итого: 14\s150 ₸/);
  assert.match(x.preview,/5 уп\. × 1\s100 ₸ = 5\s500 ₸/);
});
test('equivalent physical sizes and word order are normalized',()=>{
  for(const name of ['молотый кофе 250 г','кофе молотого 250 грамм','кофе молотый 0,25 кг','кофе молотый 250g']) assert.equal(cart([line(name,2)]).valid,true,name);
  for(const name of ['сахар 1000 граммов','сахара 1 кг']) assert.equal(cart([line(name,7)]).valid,true,name);
  for(const name of ['вода негазированная 1 литр','вода негазированная 1000 мл']) assert.equal(cart([line(name,2)]).valid,true,name);
});
test('different sizes, brands, variants and dimensions never silently substituted',()=>{
  for(const name of ['кофе молотый 500 граммов','сахар 2 килограмма','вода негазированная 1 кг','кофе Nescafe 250 г','чай белый 100 г','кофе молотый 2500 г','кофе молотый 25.0 г']) assert.equal(cart([line(name,2)]).valid,false,name);
});
test('missing rows retain a clearly labeled partial price, never a confirmed order',()=>{
  const x=cart([line('кофе',2),line('чай',5)]);
  assert.equal(x.valid,false); assert.equal(x.total,4800);
  assert.match(x.preview,/не полный итог заказа/);
  assert.doesNotMatch(x.preview,/Итого:/);
});
test('uncertainty explained specifically and never bypassed',()=>{
  const x=validateCart({items:[line('кофе',2)],uncertain:true,uncertainties:['Кофе или чай: выберите один товар.']},{},catalog);
  assert.equal(x.valid,false); assert.match(x.preview,/Кофе или чай/);
});
test('latest voice maps size with по and exact sugar kilograms',()=>{
  const x=cart([line('Кофе молотый 250 граммов',7,'шт'),line('Сахар',10,'килограмм'),line('Чай зеленый по 100 грамм',20,'упаковка')]);
  assert.equal(x.valid,true); assert.equal(x.total,44300); assert.deepEqual(x.rows.map(p=>p.quantity),[7,10,20]);
  assert.match(x.preview,/10 килограмм = 10 уп\./);
});
test('exact physical quantities accepted without rounding or dimension mixing',()=>{
  assert.equal(cart([line('кофе',0.5,'кг')]).rows[0].quantity,2);
  assert.equal(cart([line('сахар',10000,'г')]).rows[0].quantity,10);
  assert.equal(cart([line('сахар',1.5,'кг')]).valid,false);
  assert.equal(cart([line('вода',3,'кг')]).valid,false);
  assert.equal(cart([line('сахар',3,'литр')]).valid,false);
  assert.equal(cart([line('кофе',251,'г')]).valid,false);
  assert.equal(cart([line('сахар',1001,'кг')]).valid,false);
});
test('spoken adjective sizes and separated negation keep exact product identity',()=>{
  for(const name of ['чай зеленый 100 граммовый','чай зеленый 100-граммовый','чай зеленый 100 граммовая']) assert.equal(cart([line(name,17)]).total,18700,name);
  assert.equal(cart([line('вода литровая не газированная',12,'бутылка')]).total,3600);
  for(const name of ['вода полулитровая не газированная','вода литровая газированная','чай зеленый 200-граммовый']) assert.equal(cart([line(name,2)]).valid,false,name);
});
test('explicit bundle factor is separate from product name and converted by code',()=>{
  const x=cart([line('чай зеленый 100 граммовый',17,'упаковка'),line('сахар',35,'кг'),{...line('вода литровая не газированная',1,'блок'),unitsPerBundle:12,bundleUnit:'бутылка'}]);
  assert.equal(x.valid,true); assert.equal(x.total,41550); assert.deepEqual(x.rows.map(p=>p.quantity),[17,35,12]);
  assert.match(x.preview,/1 блок × 12 бут\. = 12 бут\./);
  assert.equal(cart([{...line('вода',2,'блок'),unitsPerBundle:6,bundleUnit:'бутылка'}]).rows[0].quantity,12);
});
test('bundle size never guessed and inconsistent or excessive bundles blocked',()=>{
  for(const factor of [undefined,null,0,-1,1.5,'12',1001]) assert.equal(cart([{...line('вода',1,'блок'),unitsPerBundle:factor,bundleUnit:'бутылка'}]).valid,false);
  assert.equal(cart([{...line('вода',1,'блок'),unitsPerBundle:12,bundleUnit:'кг'}]).valid,false);
  assert.equal(cart([{...line('вода',100,'блок'),unitsPerBundle:12,bundleUnit:'бутылка'}]).valid,false);
  assert.equal(cart([{...line('вода',12,'бутылка'),unitsPerBundle:12,bundleUnit:'бутылка'}]).valid,false);
  assert.equal(cart([{...line('вода литровая не газированная 12 бутылок',1,'блок'),unitsPerBundle:12,bundleUnit:'бутылка'}]).valid,false);
});
const dialogItems=[line('вода',70,'л'),line('сахар',55,'кг'),line('чай зеленый 100 г',15,'упаковка')];
const dialog={sourceText:'Чай 15 грамм или 15 упаковок',items:dialogItems,questions:['Чай: 15 грамм или 15 упаковок?']};
const contextRows=[{id:10,chatId:'100000001',status:'needs_clarification',token:'question1',telegramMessageId:'22',expiresAt:'2026-10-02T12:00:00Z',payload:JSON.stringify({dialogue:dialog})}];
const dialogNow=Date.parse('2026-10-01T12:00:00Z');
test('clarification context selected by chat, status, expiry and message',()=>{
  const ctx={chatId:'100000001',text:'Чай 15 упаковок',replyMessageId:'22'};
  assert.equal(attachDialogue(ctx,contextRows,dialogNow).dialogue.token,'question1');
  for(const rows of [[{...contextRows[0],chatId:'other'}],[{...contextRows[0],status:'confirmed'}],[{...contextRows[0],expiresAt:'2026-10-01T10:00:00Z'}]]) assert.equal(attachDialogue(ctx,rows,dialogNow).dialogue,null);
  assert.equal(attachDialogue({...ctx,replyMessageId:'wrong'},contextRows,dialogNow).dialogue,null);
});
test('new full order never implicitly merges previous clarification',()=>{
  const ctx={chatId:'100000001',text:'Две упаковки кофе и три упаковки сахара'};
  assert.equal(attachDialogue(ctx,contextRows,dialogNow).dialogue,null);
  assert.equal(attachDialogue({...ctx,text:'Новый заказ чай 15 упаковок',replyMessageId:'22'},contextRows,dialogNow).dialogue,null);
  assert.equal(attachDialogue({...ctx,dryRun:true,text:'Новый заказ кофе 2 упаковки',fixtureDialogue:dialog},[],dialogNow).dialogue,null);
});
test('bare yes keeps all lines and never chooses an ambiguous unit or confirms',()=>{
  assert.equal(vagueReply('Да'),true); assert.equal(vagueReply('Да надо поменять'),true); assert.equal(vagueReply('15 упаковок'),false);
  const ctx=attachDialogue({chatId:'100000001',text:'Да'},contextRows,dialogNow);
  const x=validateCart({items:[],uncertain:false},ctx,catalog);
  assert.equal(x.valid,false); assert.equal(x.total,67750); assert.equal(x.rows.length,3);
  assert.match(x.preview,/15 грамм или 15 упаковок/); assert.doesNotMatch(x.preview,/Нужен заказ от 1/);
});
test('vague correction preserves cart and asks only what should change',()=>{
  const ctx=attachDialogue({chatId:'100000001',text:'Да надо поменять'},contextRows,dialogNow);
  const x=validateCart({items:[],uncertain:false},ctx,catalog);
  assert.equal(x.valid,false); assert.equal(x.total,67750); assert.match(x.preview,/Что именно поменять/);
});
test('quoted legacy question is bounded and must be authored by this bot',()=>{
  const text='Распознано: Чай 100 г 15 упаковок\n\nНужно уточнить:\n• Чай: 15 грамм или 15 упаковок?\n\nПосмотрите /catalog';
  const m=message({text:'Да надо поменять',reply_to_message:{message_id:22,from:{id:200000002,is_bot:true},date:dialogNow/1000-10,text}});
  const ctx=normalizeUpdate(m,config); assert.match(ctx.replyText,/\n\n/);
  assert.equal(attachDialogue(ctx,[],dialogNow).dialogue.sourceText,'Чай 100 г 15 упаковок');
  m.message.reply_to_message.from.id=1;
  assert.equal(attachDialogue(normalizeUpdate(m,config),[],dialogNow).dialogue,null);
});
test('clarification payload retains raw source, all items and current questions',()=>{
  const x=validateCart({items:dialogItems,uncertain:true,uncertainties:dialog.questions},{text:'source'},catalog);
  const saved=JSON.parse(x.payload); assert.equal(saved.version,2); assert.equal(saved.dialogue.items.length,3); assert.equal(saved.dialogue.sourceText,'source');
  assert.match(x.preview,/Остальные позиции сохранены/);
});
test('displayed short-answer formats retain context and colon new-order resets it',()=>{
  for(const text of ['Чай — 20 упаковок','Чай: 20 упаковок','Чай20упаковок','20 упаковок']) assert.equal(attachDialogue({chatId:'100000001',text},contextRows,dialogNow).dialogue.token,'question1',text);
  assert.equal(attachDialogue({chatId:'100000001',text:'Новый заказ: чай20упаковок'},contextRows,dialogNow).dialogue,null);
});
test('catalog aliases with an exact catalog size identify water without fuzzy substitution',()=>{
  for(const name of ['вода 1 л','вода 1 литр','вода литровая','вода 1000 мл','воды 1 л']) {
    const x=cart([line(name,17,'бутылка')]);
    assert.equal(x.valid,true,name); assert.equal(x.total,5100,name);
  }
  for(const name of ['вода 2 л','вода 1 кг','вода газированная 1 л','вода BonAqua 1 л','кофе молотый 200 г']) assert.equal(cart([line(name,17)]).valid,false,name);
  const duplicate={...catalog.find(p=>p.sku==='WATER-1L'),sku:'SECOND-WATER',name:'Другая вода 1 л'};
  assert.equal(validateCart(extract([line('вода 1 л',17,'бутылка')]),{},[...catalog,duplicate]).valid,false);
});
test('water packaging asks a focused question instead of inventing bundle size',()=>{
  const x=cart([line('вода 1 л',17,'упаковка')]);
  assert.equal(x.valid,false); assert.equal(x.rows.length,0);
  assert.match(x.preview,/17 отдельных бутылок или 17 блоков/);
  assert.doesNotMatch(x.preview,/Какой товар нужен вместо/);
});
test('latest order preserves missing coffee size and calculates known tea and water only',()=>{
  const x=cart([line('кофе молотый 200 г',17,'упаковка'),line('чай черный 100 г',17,'упаковка'),line('вода 1 л',17,'бутылка')]);
  assert.equal(x.valid,false); assert.equal(x.total,20400);
  assert.deepEqual(x.rows.map(p=>p.quantity),[17,17]);
  assert.equal(x.issues.length,1); assert.match(x.issues[0],/200 г/);
});
