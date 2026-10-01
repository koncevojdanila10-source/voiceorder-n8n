function clean(value, limit = 180) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit) : '';
}

function normalizedName(value) {
  let text = clean(value).normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/(\d),(\d)/g, '$1.$2').replace(/(^|\s)по\s+(?=\d)/gu, '$1');
  text = text.replace(/(^|[^\p{L}])не\s+газированн(?:ая|ую|ой|ое|ый|ого)(?=$|[^\p{L}])/gu, (_, start) => start + 'негазированная');
  text = text.replace(/(^|[^\p{L}])(полулитров|литров)(?:ая|ую|ой|ое|ый|ого|ые|ых)(?=$|[^\p{L}])/gu, (_, start, size) => start + (size === 'полулитров' ? '0.5 л' : '1 л'));
  const measures = [
    [/(\d+(?:\.\d+)?)\s*(?:килограмм(?:а|ов|у)?|кг|kg)(?=$|[^\p{L}])/gu, 1000, 'g'],
    [/(\d+(?:\.\d+)?)[\s-]*(?:граммов(?:ый|ая|ое|ую|ой|ого|ые|ых)|грамм(?:а|ов|у)?|г|grams?|g)(?=$|[^\p{L}])/gu, 1, 'g'],
    [/(\d+(?:\.\d+)?)\s*(?:миллилитр(?:а|ов)?|мл|ml)(?=$|[^\p{L}])/gu, 1, 'ml'],
    [/(\d+(?:\.\d+)?)\s*(?:литр(?:а|ов)?|л|liters?|litres?|l)(?=$|[^\p{L}])/gu, 1000, 'ml']
  ];
  for (const [pattern, factor, unit] of measures) text = text.replace(pattern, (_, n) => String(Number(n) * factor) + unit);
  const forms = {сахара:'сахар',воды:'вода',чая:'чай',зеленого:'зеленый',зеленым:'зеленый',черного:'черный',черным:'черный',молотого:'молотый',молотым:'молотый',негазированной:'негазированная'};
  return text.replace(/[^\p{L}\p{N}.]+/gu, ' ').trim().split(/\s+/).map(w => forms[w] || w).sort().join(' ');
}

function money(value) {
  return Number(value).toLocaleString('ru-RU') + ' ₸';
}

function quantityUnit(quantity, unit) {
  if (unit === 'упаковка') return 'уп.';
  if (unit === 'бутылка') return 'бут.';
  return unit;
}

function measureUnit(value) {
  const unit = normalizedName(value);
  if (['кг','килограмм','килограмма','килограммов','kg'].includes(unit)) return {unit:'g',factor:1000};
  if (['г','грамм','грамма','граммов','g'].includes(unit)) return {unit:'g',factor:1};
  if (['л','литр','литра','литров','l'].includes(unit)) return {unit:'ml',factor:1000};
  if (['мл','миллилитр','миллилитра','миллилитров','ml'].includes(unit)) return {unit:'ml',factor:1};
  return null;
}

function normalizeUpdate(update, config) {
  const help = 'VoiceOrder — ДЕМО, не настоящий магазин. Цены и товары тестовые.\nОтправьте полный заказ текстом, голосовым или аудиофайлом.\nПример: «Две упаковки кофе и три упаковки сахара».\nПосле проверки нажмите «Подтвердить». Заказ сохранится только в демо-журнале; оплаты и отправки поставщику нет.\n/catalog — каталог. /example — пример. Пока бот уточняет заказ, отвечайте на вопрос или пишите конкретную правку — остальные позиции сохраняются. «Новый заказ» — начать заново. Готовый черновик с кнопками для изменения сначала отмените; подтверждённые записи не редактируются. Русский и казахский поддерживаются как тестовый сценарий; всегда проверяйте распознанный текст.';
  if (update._manualDemo === true) return {route:'text', dryRun:true, chatId:'demo', inputMessageId:'demo', text: clean(update.demoText, 4000), help, caseName:clean(update.caseName), expected: update.expected || null, fixtureDialogue:update.fixtureDialogue || null};
  const q = update.callback_query;
  const m = q ? q.message : update.message;
  const chatId = String(m?.chat?.id || '');
  const allowed = String(config.allowedChatIds || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!m || m.chat.type !== 'private' || !allowed.includes(chatId) || String((q?.from || m.from)?.id || '') !== chatId || (q?.from || m.from)?.is_bot) return null;
  const reply = m.reply_to_message;
  const ownReply = reply?.from?.is_bot === true && String(reply.from.id) === String(config.botId || '');
  const base = {chatId, inputMessageId:String(m.message_id || ''), dryRun:false, help, replyMessageId:ownReply ? String(reply.message_id || '') : '', replyText:ownReply && typeof reply.text === 'string' ? reply.text.replace(/[\u0000-\u0009\u000b-\u001f]/g,' ').trim().slice(0,4000) : '', replyDate:ownReply ? Number(reply.date || 0) : 0};
  if (q) {
    const match = /^vo:(a|x):([a-zA-Z0-9_-]{1,40})$/.exec(q.data || '');
    if (!match) return {...base, route:'help', help:'Эта кнопка не относится к VoiceOrder. Отправьте новый полный заказ.'};
    return {...base, route:'callback', action:match[1], token:match[2], queryId:String(q.id), previewMessageId:String(m.message_id)};
  }
  const text = typeof m.text === 'string' ? m.text.trim() : '';
  const command = text.toLowerCase().split(/\s/)[0].split('@')[0];
  if (['/start','/help','/example','/пример'].includes(command)) return {...base, route:'help'};
  if (command === '/catalog') return {...base, route:'help', help:'ДЕМО-КАТАЛОГ. Вымышленные цены, наличие не проверяется.\n' + config.catalog.map(p => `${p.sku}: ${p.name} — ${p.price} ${p.currency}/${p.unit}`).join('\n')};
  if (text.length > 4000) return {...base, route:'help', help:'Заказ слишком длинный. Максимум 4000 символов и 20 строк товаров.'};
  if (text) return {...base, route:'text', text};
  const a = m.voice || m.audio || (m.document && (/^audio\//.test(m.document.mime_type || '') || /\.(mp3|mp4|m4a|ogg|wav|webm|flac|mpeg|mpga)$/i.test(m.document.file_name || '')) ? m.document : null);
  if (a && Number(a.file_size) > 19 * 1024 * 1024) return {...base, route:'help', help:'Аудио слишком большое. Отправьте файл до 19 МБ.'};
  if (a?.file_id) return {...base, route:'audio', fileId:a.file_id};
  return {...base, route:'help'};
}

function vagueReply(value) {
  return /^(?:да|ага|угу|ок|окей|нет|иә|ия|жоқ)(?:\s+(?:надо|нужно|хочу))?(?:\s+(?:поменять|изменить|исправить))?[.!?\s]*$/iu.test(clean(value,200));
}

function attachDialogue(context, records, now = Date.now()) {
  const text = clean(context.text,4000);
  if (/^(?:новый заказ|\/new)(?=\s|:|$)/iu.test(text)) return {...context,dialogue:null};
  if (context.dryRun) return {...context,dialogue:context.fixtureDialogue || null};
  const recent = records.filter(r => r.chatId === context.chatId && r.status === 'needs_clarification' && new Date(r.expiresAt).getTime() > now).sort((a,b)=>Number(b.id)-Number(a.id));
  const formattedText = text.replace(/[—–:]/g,' ').replace(/\s+/g,' ');
  const followup = !!context.replyMessageId || vagueReply(text) || /(?:поменя|замени|исправ|вместо|уточн|должно быть)/iu.test(text) || (/^\s*(?:(?:чай|кофе|сахар|вода)\s*)?\d+\s*(?:упаков|пач|штук|шт|кг|килограмм|бутыл|литр)/iu.test(formattedText) && text.length < 180);
  if (!followup) return {...context,dialogue:null};
  for (const row of recent) {
    if (context.replyMessageId && row.telegramMessageId !== context.replyMessageId) continue;
    let payload;
    try {payload=JSON.parse(row.payload);} catch {continue;}
    if (!payload.dialogue || !Array.isArray(payload.dialogue.items) || !payload.dialogue.items.length) continue;
    return {...context,dialogue:{...payload.dialogue,token:row.token,sourceText:clean(payload.dialogue.sourceText,4000)}};
  }
  if (context.replyText?.includes('Нужно уточнить:') && context.replyText.startsWith('Распознано:') && context.replyDate && now/1000-context.replyDate < 86400 && now/1000-context.replyDate >= 0) {
    const sourceText = context.replyText.slice('Распознано:'.length).split(/\n\n/)[0].trim();
    const questions = context.replyText.split('Нужно уточнить:')[1].split(/Посмотрите|Отправьте/)[0].split('•').map(s=>s.trim()).filter(Boolean);
    return {...context,dialogue:{sourceText,items:[],questions,fromQuotedQuestion:true}};
  }
  return {...context,dialogue:null};
}

function validateCart(extraction, context, catalog) {
  extraction = extraction && typeof extraction === 'object' ? {...extraction} : {items:[]};
  if (context.dialogue && vagueReply(context.text)) {
    if (context.dialogue.items?.length) extraction.items = context.dialogue.items;
    extraction.uncertain = true;
    extraction.uncertainties = /(?:поменять|изменить|исправить)/iu.test(context.text) ? ['Что именно поменять: товар, количество или единицу? Например: «Чай — 20 упаковок». Остальные позиции сохранены.'] : [...(context.dialogue.questions?.length ? context.dialogue.questions : ['Укажите конкретное значение, например: «Чай — 15 упаковок». «Да» не выбирает между вариантами.'])];
  }
  const issues = [];
  const cart = new Map();
  const items = extraction && Array.isArray(extraction.items) ? extraction.items : [];
  if (!items.length && !extraction.uncertain) issues.push(vagueReply(context.text) ? 'Не вижу заказа для этого ответа. Отправьте заказ или ответьте на сообщение с вопросом.' : 'Укажите товар и количество.');
  if (items.length > 20) issues.push('Максимум 20 строк товаров.');
  if (extraction?.uncertain === true) {
    const reasons = Array.isArray(extraction.uncertainties) ? extraction.uncertainties.map(s => clean(s,180)).filter(Boolean) : [];
    issues.push(...(reasons.length ? reasons.slice(0,5) : ['Не удалось однозначно разобрать заказ. Уточните названия и количество.']));
  }
  const unitAliases = {'упаковка':['упаковка','упаковки','упаковок','пачка','пачки','пачек','пакет','пакета','пакетов','қаптама','шт','штука','штуки','штук','дана'], 'бутылка':['бутылка','бутылки','бутылок','шт','штука','штуки','штук','дана','бөтелке']};
  for (const item of items.slice(0,20)) {
    const product = clean(item.product);
    const name = normalizedName(product);
    const candidates = catalog.filter(p => {
      const aliases = Array.isArray(p.aliases) ? p.aliases : [];
      const size = p.packSize;
      const sizedAliases = size && Number.isSafeInteger(size.amount) && size.amount > 0 && ['g','ml'].includes(size.unit) ? aliases.map(a => `${a} ${size.amount}${size.unit}`) : [];
      return [p.sku,p.name,...aliases,...sizedAliases].some(a => normalizedName(a) === name);
    });
    if (candidates.length !== 1) {
      const hints = catalog.filter(p => [p.name,...p.aliases].some(a => normalizedName(a).includes(name) && name.length > 1)).map(p => p.name);
      issues.push(hints.length ? `Какой товар нужен вместо «${product || 'без названия'}»: ${[...new Set(hints)].join(' или ')}?` : `Товар «${product || 'без названия'}» не найден в каталоге. Уточните название или размер упаковки.`);
      continue;
    }
    const p = candidates[0];
    let q = item.quantity;
    if (typeof q !== 'number' || !Number.isFinite(q) || q <= 0) {issues.push(`Укажите количество для «${p.name}».`); continue;}
    const unit = normalizedName(item.unit);
    const measure = measureUnit(item.unit);
    const conversionNotes = [];
    const bundle = ['блок','блока','блоков','коробка','коробки','коробок','ящик','ящика','ящиков'].includes(unit);
    if (bundle) {
      const count = item.unitsPerBundle;
      const innerUnit = normalizedName(item.bundleUnit);
      if (!Number.isSafeInteger(q) || !Number.isSafeInteger(count) || count <= 0 || count > 1000 || !(unitAliases[p.unit] || [p.unit]).includes(innerUnit)) {issues.push(`Сколько ${p.unit === 'бутылка' ? 'бутылок' : 'упаковок'} «${p.name}» в одном блоке/коробке? Укажите количество, размер блока не буду угадывать.`); continue;}
      conversionNotes.push(`${q} ${clean(item.unit)} × ${count} ${quantityUnit(count,p.unit)} = ${q * count} ${quantityUnit(q * count,p.unit)}; размер блока указан в сообщении`);
      q *= count;
    } else if (item.unitsPerBundle != null || clean(item.bundleUnit)) {
      issues.push(`Уточните единицу блока/коробки для «${p.name}».`); continue;
    } else if (measure) {
      const size = p.packSize;
      const baseAmount = q * measure.factor;
      if (!size || size.unit !== measure.unit || !Number.isSafeInteger(size.amount) || size.amount <= 0 || !Number.isSafeInteger(baseAmount)) {issues.push(`Не могу точно перевести «${q} ${clean(item.unit)}» в упаковки «${p.name}»: в каталоге нет подходящего размера.`); continue;}
      const count = baseAmount / size.amount;
      if (!Number.isSafeInteger(count)) {issues.push(`Для «${p.name}» ${q} ${clean(item.unit)} не дают целого числа упаковок. Укажите число упаковок; округлять не буду.`); continue;}
      conversionNotes.push(`${q} ${clean(item.unit)} = ${count} ${quantityUnit(count,p.unit)} по размеру из каталога`);
      q = count;
    } else if (unit && !(unitAliases[p.unit] || [p.unit]).includes(unit)) {
      issues.push(p.unit === 'бутылка' && (unitAliases['упаковка'].includes(unit)) ? `«${p.name}»: ${q} отдельных бутылок или ${q} блоков? Если блоков, сколько бутылок в каждом?` : `Для «${p.name}» укажите количество в единицах каталога: ${p.unit}. Единица «${clean(item.unit)}» не поддерживается.`);
      continue;
    }
    if (!Number.isInteger(q) || q > 1000) {issues.push(`Укажите целое количество от 1 до 1000 для «${p.name}».`); continue;}
    if (!Number.isSafeInteger(p.price) || p.price < 0 || p.currency !== 'KZT') {issues.push('Некорректная цена или валюта в каталоге. Нужна проверка владельцем.'); continue;}
    const old = cart.get(p.sku);
    const quantity = q + (old?.quantity || 0);
    if (quantity > 1000) {issues.push(`Суммарное количество «${p.name}» превышает 1000.`); continue;}
    cart.set(p.sku, {sku:p.sku,name:p.name,unit:p.unit,quantity,price:p.price,currency:p.currency,amount:quantity*p.price,...((conversionNotes.length || old?.conversionNotes?.length) ? {conversionNotes:[...(old?.conversionNotes || []),...conversionNotes]} : {})});
  }
  const rows = [...cart.values()];
  const total = rows.reduce((s,p) => s+p.amount,0);
  if (!Number.isSafeInteger(total)) issues.push('Некорректная сумма заказа.');
  const transcript = context.source === 'audio' ? `Распознано: ${clean(context.text, 800)}\n\n` : '';
  const valid = issues.length === 0 && rows.length > 0;
  const lines = rows.map((p,i) => `${i+1}. ${p.name}\n${p.quantity} ${quantityUnit(p.quantity,p.unit)} × ${money(p.price)} = ${money(p.amount)}` + (p.conversionNotes?.length ? '\n' + p.conversionNotes.join('; ') : '')).join('\n\n');
  const preview = valid ? transcript + '🛒 Черновик демо-заказа\n\n' + lines + `\n\nИтого: ${money(total)}\n\nПроверьте и подтвердите заказ. Товары и цены тестовые; это запись в демо-журнале, без оплаты и отправки поставщику.` : transcript + (rows.length ? 'Распознанные позиции (ещё не подтверждены):\n\n' + lines + `\n\nСумма этих позиций: ${money(total)}. Это не полный итог заказа.\n\n` : '') + 'Нужно уточнить:\n' + [...new Set(issues)].map(s => '• '+s).join('\n') + (items.length ? '\n\nОтветьте здесь только на вопрос или напишите, что поменять. Остальные позиции сохранены. «Новый заказ» — начать заново. /catalog — каталог.' : '\n\nОтправьте товар и количество или ответьте на сообщение с вашим заказом. /catalog — каталог.');
  const dialogue = {sourceText:clean(context.dialogue?.sourceText || context.text,4000),items,questions:[...new Set(issues)]};
  return {...context, valid, rows, total, currency:'KZT', preview, payload:JSON.stringify({version:2,demo:true,rows,total,currency:'KZT',preview,dialogue}), issues:[...new Set(issues)]};
}

function callbackResult(rows, context, executionId) {
  const own = rows.find(r => r.token === context.token && r.chatId === context.chatId && r.telegramMessageId === context.previewMessageId && r.claimExecutionId === String(executionId) && ['confirmed','cancelled'].includes(r.status));
  if (!own) return {chatId:context.chatId, previewMessageId:context.previewMessageId, available:false, preview:'Кнопка уже использована, черновик просрочен или недоступен. Если подтверждение прошло, запись остаётся в демо-журнале. Не отправляйте тот же заказ повторно без проверки.'};
  return {chatId:context.chatId, previewMessageId:context.previewMessageId, available:true, token:own.token, status:own.status, preview:own.status === 'confirmed' ? `ДЕМО-ЗАКАЗ ${own.token} сохранён.\nЭто не покупка: поставщик не уведомлён, оплаты и резервирования нет.\n` + JSON.parse(own.payload).preview : 'Черновик отменён. Для исправления отправьте полный заказ заново.'};
}

module.exports = {clean, normalizedName, money, quantityUnit, measureUnit, normalizeUpdate, vagueReply, attachDialogue, validateCart, callbackResult};
