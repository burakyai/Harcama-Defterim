/* Harcama Defteri — internetsiz kart ekstresi okuyucu.
   Girdi: pdf.js'den sayfa sayfa satırlar (string[][]). Çıktı: Claude'un ürettiği JSON ile aynı biçim.
   Tanınan bankalar: VakıfBank, QNB (asıl + sanal kart), İş Bankası Maximiles. Diğerleri için genel okuma + uyarı. */
(function (root) {
  "use strict";
  const CATS = ["Yemek", "Market", "Ulaşım", "Faturalar", "Kira/Ev", "Alışveriş", "Eğlence", "Sağlık", "Seyahat", "İş", "Bakım", "Diğer"];

  // Karşılaştırma için: büyük harf, Türkçe harfler sadeleşmiş.
  const fold = s => String(s || "").toLocaleUpperCase("tr").replace(/İ/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G")
    .replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C").replace(/I/g, "I").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const r2 = n => Math.round(n * 100) / 100;
  const iso = (d, m, y) => `${y}-${m}-${d}`;
  const pad = n => String(n).padStart(2, "0");
  const addDays = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const addMonths = (s, n) => { const [y, m, d] = s.split("-").map(Number); const t = new Date(y, m - 1 + n, 1, 12); const dim = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(Math.min(d, dim))}`; };
  const gap = (a, b) => Math.abs(Math.round((new Date(a + "T12:00:00") - new Date(b + "T12:00:00")) / 864e5));

  // Para biçimleri: "1,234.56" (VakıfBank, QNB) ya da "1.234,56" (Maximiles)
  const MONEY_EN = /^[+-]?\d{1,3}(,\d{3})*\.\d{2}$/;
  const MONEY_TR = /^[+-]?\d{1,3}(\.\d{3})*,\d{2}$/;
  const num = (s, tr) => { s = String(s).trim().replace(/\s|TL/g, ""); s = tr ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""); return Number(s); };

  function detectBank(text) {
    const t = fold(text);
    if (/MAXIMILES/.test(t)) return { bank: "İş Bankası", card: "Maximiles", tr: true };
    if (/MAXIMUM/.test(t) && /KREDI KARTI HESAP OZETI/.test(t)) return { bank: "İş Bankası", card: "Maximum", tr: true };
    if (/QNB/.test(t)) return { bank: "QNB", card: "QNB", tr: false };
    if (/VAKIF|WORLDPUAN/.test(t)) return { bank: "VakıfBank", card: "VakıfBank", tr: false };
    return { bank: "", card: "Kart", tr: /\d\.\d{3},\d{2}/.test(text) && !/\d,\d{3}\.\d{2}/.test(text), unknown: true };
  }

  // Ekstre başlığından tutar bulma
  function grabAmount(lines, re, tr) {
    for (const l of lines) { const m = fold(l).match(re); if (m) { const tok = l.slice(0).split(/\s{2,}|:\s*/).map(x => x.trim()).filter(x => (tr ? MONEY_TR : MONEY_EN).test(x.replace(/^\*|\s*TL$/g, ""))); if (tok.length) return num(tok[0].replace(/^\*/, ""), tr); } }
    return null;
  }
  function grabDate(lines, re) {
    for (const l of lines) { const f = fold(l); if (/SONRAKI/.test(f)) continue; const m = f.match(re); if (m) return iso(m[1], m[2], m[3]); }
    return null;
  }

  // Satıcı anahtarı: iade/indirimleri doğru harcamaya bağlamak için
  const PREFIX = /^(IADE|IYZICO|PAYCELL|MOKA ?UNITED|NKOLAY|N KOLAY|SIPAY ELEK|HALKODE OD|TAMI?-?ODEME|TAM-?ODEME|TAM ODEME|YEMEKPAY|TKPAY|PAYTR( ODEME)?|PARAT|S|REFUND|DL)\s*\/?\s*/;
  function merchantKey(desc) {
    let s = fold(desc).replace(/-ESKI KART/g, "").replace(/\(.*?\)/g, " ");
    for (let i = 0; i < 3; i++) s = s.replace(PREFIX, "");
    s = s.replace(/^\*+/, "");
    const w = (s.match(/[A-Z]{3,}/) || [""])[0];
    return w.replace(/(\d+)$/, "");
  }

  // Kategori ve okunur isim kuralları (sıra önemli: ilk eşleşen kazanır)
  const RULES = [
    [/SAGLIK HIZMET|HASTANE|TIP MERKEZI/, "Sağlık", null], [/YEMEKSEPETI|YEMEKPAY/, "Yemek", "Yemeksepeti"], [/MC ?DONALDS|BURGER KING|BIG CHEFS|LUIGIS|ETLI EKMEK|EKMEK|SIMIT/, "Yemek", null], [/UBER\s*\*?\s*EATS|UBER EATS/, "Yemek", "Uber Eats"],
    [/STARBUCKS|SBUX|SBX /, "Yemek", "Starbucks"], [/GETIR/, "Market", "Getir"], [/MIGROS|MGROS/, "Market", "Migros"],
    [/A101|BIM |SOK MARKET|CARREFOUR|MACROCENTER|METRO /, "Market", null],
    [/LIME/, "Ulaşım", "Lime scooter"], [/BITAKSI|MOKAUNTED/, "Ulaşım", "BiTaksi"], [/BOLT/, "Ulaşım", "Bolt"], [/UBER/, "Ulaşım", "Uber"],
    [/TIKTAK|TKTAKKRALA|TIKTAKKIRALA/, "Ulaşım", "TikTak araç kiralama"], [/HOP SCOOT|HOP SCOOTER/, "Ulaşım", "Hop scooter"],
    [/HGS/, "Ulaşım", "HGS yükleme"], [/TAKSI|SITAXI|POAS/, "Ulaşım", null], [/VALE/, "Ulaşım", "Vale"], [/PETROL|OPET|SHELL|\bBP\b|AKARYAKIT|TOTAL ENERJI/, "Ulaşım", null],
    [/OTOPARK|TAYA YOLCU|ISPARK/, "Ulaşım", null], [/OTOMOTIV/, "Ulaşım", null],
    [/TKPAY \/ AJET|AJET/, "Seyahat", "AJet"], [/TURKISH AIRLINES|TKPAY|THY/, "Seyahat", "THY"], [/PEGASUS/, "Seyahat", "Pegasus"],
    [/HILTON|HOTEL|OTEL/, "Seyahat", null], [/LOUNGE IST|PPL LOUNGE|HAVA ?LIMANI|HAVALIMANI/, "Seyahat", null], [/LOUNGE|BAR |PUB |CLUB/, "Eğlence", null], [/TURIZM|TOUR/, "Seyahat", null],
    [/APPLE\.COM|APPLE COM\/BILL/, "Faturalar", "Apple abonelik"], [/SIGORTA/, "Faturalar", null], [/TURKCELL|VODAFONE|TURK TELEKOM|TT NET|SUPERONLINE/, "Faturalar", null],
    [/ISKI|IGDAS|ELEKTRIK|ENERJISA|AYESAS|CK BOGAZICI/, "Faturalar", null],
    [/APSIYON|CONDOLIFE|TESIS YONETIM|SITE YONETIM|AIDAT|GAYRIMENKUL|DEPOLAMA/, "Kira/Ev", null], [/IKEA|BAUHAUS|KOCTAS|ENGLISH HOME|VESTEL|MADAME COCO/, "Kira/Ev", null],
    [/ECZANE|ECZANESI|SAGLIK HIZMET|ACIBADEM|MEDIPOL|MLP SAGLIK|MEDICAL PARK|HASTANE|KLINIK|VETERINER|SUPPLEMENT/, "Sağlık", null],
    [/AV MALZEME|AV BAYII|SAVUNMA|AMAZONPRIME|STANDUP|STAND UP|TIYATRO|STEAM|PLAYSTATION|SPOTIFY|EXXEN|NETFLIX|PATREON|WEMOD|POLIGON|SINEMA|PARIBU|YOUTUBE/, "Eğlence", null],
    [/PARASUT|LOGO YAZILIM|HIGGSFIELD|WAVES|OPENAI|ANTHROPIC|ADOBE|CANVA|NOTION|FACEBK|FB\.ME|FACEBOOK|GOOGLE\*? ?WORKSPACE|LINKTREE|WETRANSFER|SPLICE/, "İş", null],
    [/KUAFOR|BERBER|LOSTRA|KOZMETIK|SEPHORA|GRATIS|WATSONS|MAKYAJ|PARFUM|PARF|ROSSMA|GUZELLIK/, "Bakım", null],
    [/V\.D\.|VERGI DAIRESI|GIB\.GOV/, "Diğer", "Vergi ödemesi"], [/SGK|VERGI/, "Diğer", null],
    [/AY MARKA|GURBUZ|GRBZ|TRENDYOL|HEPSIBURADA|AMAZON|BEYMEN|ZARA|PRADA|STONE|LA VALLEE|INTIMISSIMI|LULULEMON|SUPERSTEP|DECATHLON|TEKNOSA|MEDIAMARKT|MEDIA MARKT|MANGO|OYSHO|H&M|HENNES|SAGAZA|DIESEL|NOCTURNE|ZUHAL MUZIK|APPLE STORE|KUYUM|MAGAZA|TEKSTIL|TEKST|STORE|SHOPIER|BOYNER|MAVI|LC WAIKIKI|UNIFREE|DUTY FREE|OFFENDER|NARKONTEKS|ADESA|POLISSEPETI|CRAFTLABEL|KRAFTCOVER/, "Alışveriş", null],
    [/LOKANTA|RESTORAN|RESTAURANT|OCAKBASI|KEBAP|KOFTE|DONER|BURGER|PIZZA|STEAKHOUSE|CAFE|KAFE|KAHVE|DONDURMA|BUFE|BALIK|CATERING|PASTANE|MIDPOINT|KANATCI|HAMSI|KASE NO|FINDIK OCAGI|SALONU|FIKO|HAMSIBURNU|AMBURNU|LILLO/, "Yemek", null],
    [/MARKET|GIDA|BAKKAL|CIFLIK|MANAV|KASAP|SARKUTERI|FIRINI|FIRIN|DOGAL|DENIZ URUN|GULMAR|GLMAR|KARMAR|^ER MAR|SECCO/, "Market", null],
  ];
  const NAMES = [[/TRENDYOL/, "Trendyol"], [/APSIYON/, "Apsiyon (site aidatı)"], [/ALLIANZ/, "Allianz sigorta"], [/QNB SIGORTA/, "QNB Sigorta"],
    [/TT MOBIL|TURK TELEKOM MOBIL/, "Türk Telekom Mobil"], [/MEDIA ?MARKT/, "MediaMarkt"], [/MANGO/, "Mango"], [/SEPHORA/, "Sephora"], [/FACEBK|FB\.ME|FACEBOOK/, "Facebook reklam"],
    [/LINKTREE/, "Linktree"], [/WETRANSFER/, "WeTransfer"], [/GOOGLE\*? ?WORKSPACE/, "Google Workspace"], [/NETFLIX/, "Netflix"], [/AMAZONPRIME/, "Amazon Prime"], [/ADOBE/, "Adobe"],
    [/CANVA/, "Canva"], [/SPLICE/, "Splice"], [/MAKYAJTRENDI/, "Makyajtrendi"], [/OYSHO/, "Oysho"], [/DIESEL/, "Diesel"], [/H&M|HENNES/, "H&M"], [/SAGAZA/, "Sagaza"],
    [/ROSSMA/, "Rossmann"], [/MC ?DONALDS/, "McDonald's"], [/BIG CHEFS/, "Big Chefs"], [/PEGASUS/, "Pegasus"], [/SUPERONLINE/, "Superonline"], [/ADESA/, "Adesa"], [/ENERJISA|AYESAS/, "Enerjisa elektrik"], [/TT NET/, "Türk Telekom internet"], [/TURKCELL/, "Turkcell"], [/ISKI/, "İSKİ su"], [/IGDAS/, "İGDAŞ doğalgaz"], [/ULUDAG ELEKTRIK/, "Uludağ Elektrik"],
    [/SGK/, "SGK prim ödemesi"], [/VERGI/, "Vergi ödemesi"], [/STEAM/, "Steam"], [/PLAYSTATION/, "PlayStation"], [/SPOTIFY/, "Spotify"], [/EXXEN/, "Exxen"],
    [/PATREON/, "Patreon"], [/WEMOD/, "WeMod Pro"], [/PARIBU/, "Paribu Pass"], [/OPENAI/, "OpenAI"], [/HIGGSFIELD/, "Higgsfield"], [/WAVES/, "Waves"],
    [/PRADA/, "Prada"], [/LA VALLEE STONE|STONE ISLAND/, "Stone Island"], [/BAUHAUS/, "Bauhaus"], [/BEYMEN/, "Beymen"], [/ZARA/, "Zara"], [/LULULEMON/, "Lululemon"],
    [/SUPERSTEP/, "Superstep"], [/DECATHLON/, "Decathlon"], [/INTIMISSIMI/, "Intimissimi"], [/TEKNOSA/, "Teknosa"], [/HILTON/, "Hilton otel"], [/SUPPLEMENTLER/, "Supplementler.com"],
    [/ACIBADEM/, "Acıbadem"], [/MEDIPOL/, "Medipol"], [/MLP SAGLIK/, "Medical Park"], [/VETERINER/, "Veteriner"], [/APPLE STORE/, "Apple Store"], [/A101/, "A101"],
    [/SHOPIER/, "Shopier"], [/POLISSEPETI/, "Polis Sepeti"], [/VESTEL/, "Vestel"], [/IKEA/, "IKEA"], [/ENGLISH HOME/, "English Home"], [/UNIFREE/, "Unifree"]];
  function niceName(desc) {
    const fd = fold(desc); for (const [re, n] of NAMES) if (re.test(fd)) return n;
    let s = String(desc).replace(/-eski kart/ig, "").replace(/\s*\((?:USD|EUR|GBP)[^)]*\)/ig, "");
    s = s.replace(/^(İADE|IADE)\s*\/\s*/i, "").replace(/\s+\d+(?:[.,]\d+)?\s+(USD|EUR|GBP)\s+SATI[SŞ]\b/i, "");
    s = s.replace(/^(MOKA ?UNITED|N ?KOLAY|SİPAY ELEK|SIPAY ELEK|HALKÖDE ÖD|HALKODE OD)\s*\/\s*/i, "");
    s = s.replace(/^(IYZICO|PAYCELL|TAMİ?-?ÖDEME|TAM-?ÖDEME|TAM ÖDEME|TAM-DEME|TAM DEME|YEMEKPAY|TKPAY|PAYTR( ODEME)?|PARAT|S|DL)\s*\/\s*/i, "");
    s = s.replace(/\/(İSTANBUL|ISTANBUL|TRABZON|İZMİR|IZMIR|BALIKESİR|BALIKESIR|ANKARA)\b.*$/i, "")
      .replace(/\s+(İSTANBUL|ISTANBUL|STANBUL|TRABZON)?\s*(TR|TU|NL|TRTR)$/i, "").replace(/\s+(İSTANBUL|ISTANBUL|STANBUL|TRABZON)$/i, "").replace(/\s*(İSTANBUL|ISTANBUL|TRABZON|ANKARA)\s+TUR$/i, "").replace(/\s+(İ?STANBUL|STANBUL)(\s+TR(TR)?)?$/i, "")
      .replace(/\b\d{5,}\b/g, "").replace(/\s{2,}/g, " ").trim();
    s = s.replace(/\s*\d{1,2}\.\s*Taks[İi]t/i, "").replace(/^[-*\s]+/, "").trim();
    const low = w => /[İŞĞÜÖÇışğüöç]/.test(w) ? w.toLocaleLowerCase("tr") : w.toLowerCase();
    return s.split(/(\s+)/).map(low).join("").replace(/(^|[\s\/(-])(\p{L})/gu, (m, a, b) => a + (b === "i" ? "İ" : b.toLocaleUpperCase("tr"))).slice(0, 60);
  }
  function classify(desc, history) {
    const f = fold(desc);
    for (const [re, cat, name] of RULES) if (re.test(f)) return { cat, note: name || niceName(desc) };
    const note = niceName(desc);
    const h = history && history[fold(note)];
    return { cat: h || "Diğer", note, unknown: !h };
  }

  // QNB "Dönem İçi Hareketler" dökümü: ekstre kesilmeden önceki işlemler. Banka adı ve toplamlar yok.
  function parseDonemIci(lines, opts) {
    const all = lines.join("\n"), f = fold(all);
    const last4 = (f.match(/SON 4 HANESI (\d{4})/) || [])[1] || "";
    const dm = all.match(/(\d{2})[\/.](\d{2})[\/.](\d{4})\s+tarihli/i);
    const docDate = dm ? iso(dm[1], dm[2], dm[3]) : null;
    const isQnb = /DEME - TESEKK|TKPAY|QNB/.test(f);
    const bank = isQnb ? "QNB" : "";
    const card = (opts.cards && opts.cards[last4]) || (isQnb ? "QNB" : "Kart");
    const MONEY = /^([+-]?\d+(?:\.\d{3})*(?:,\d{1,2})?)\s*(?:TRY|TL)$/;
    const items = [], skipped = [], fees = [];
    // Taksitlerin hangi aya düşeceği: bilinen son hesap kesiminden sonraki dönem; bilinmiyorsa dökümün ayı
    const lastK = opts.kesims && opts.kesims[bank];
    let win = null;
    if (lastK && docDate) { let a = lastK; while (addMonths(a, 1) < docDate) a = addMonths(a, 1); win = { from: addDays(a, 1), to: addMonths(a, 1) }; }
    for (const line of lines) {
      const m = line.match(/^\s*(\d{2})[.\/](\d{2})[.\/](\d{4})\s+(.*)$/); if (!m) continue;
      const date = iso(m[1], m[2], m[3]);
      const toks = m[4].split(/\s{3,}/).map(t => t.trim()).filter(Boolean);
      const ai = toks.findIndex((t, i) => i > 0 && MONEY.test(t)); if (ai < 1) continue;
      const desc = toks.slice(0, ai).join(" ").replace(/^\d{8}\s+/, ""), fd = fold(desc);
      const amount = r2(num(toks[ai].match(MONEY)[1], true));
      if (/DEME - TESEKK|ODEMENIZ|HESAPTAN AKTARIM/.test(fd)) { skipped.push({ desc, amount: Math.abs(amount), reason: "kart borcu ödemesi" }); continue; }
      if (/FAIZ|BSMV|KKDF/.test(fd)) { fees.push({ date, amount }); continue; }
      const tq = (toks[ai + 1] || "").match(/^(\d+)\/(\d+)/);
      const tk = tq && Number(tq[2]) > 1 ? { n: Number(tq[1]), of: Number(tq[2]) } : null;
      let { cat, note, unknown } = classify(desc, opts.history);
      let d = date;
      if (tk) {
        note += ` (${tk.n}/${tk.of} taksit)`;
        if (tk.n > 1) {
          const day = Number(date.slice(8, 10));
          if (win) { for (const base of [win.from, win.to]) { const [y, mo] = base.split("-").map(Number); const dim = new Date(y, mo, 0).getDate(); const c = `${y}-${pad(mo)}-${pad(Math.min(day, dim))}`; if (c >= win.from && c <= win.to) { d = c; break; } } }
          else if (docDate) { const [y, mo] = docDate.split("-").map(Number); const dim = new Date(y, mo, 0).getDate(); d = `${y}-${pad(mo)}-${pad(Math.min(day, dim))}`; }
        }
      }
      if (amount < 0) note += " (iade)";
      items.push({ date: d, card, amount, desc, cat, note: note.slice(0, 80), biz: /SGK|VERGI|V\.D\./.test(fd), unknown: !!unknown });
    }
    if (fees.length) items.push({ date: docDate || fees[0].date, card, amount: r2(fees.reduce((s, x) => s + x.amount, 0)), desc: "Faiz", cat: "Diğer", note: `Kart faizi ve vergileri (${bank || card})` });
    if (!items.length) return { error: "Bu dökümde harcama satırı bulunamadı." };
    items.sort((a, b) => a.date.localeCompare(b.date));
    const warnings = ["Bu bir dönem içi hareket dökümü: ekstre henüz kesilmemiş, o yüzden toplam kontrolü yapılamıyor. Ekstre kesilince onu da yükleyebilirsin, burada eklediklerin tekrar girmez."];
    if (!opts.cards || !opts.cards[last4]) warnings.push(`Kart sonu ${last4 || "?"}: bu kartı “${card}” olarak kaydettim. Ekstresini bir kez yüklediğinde kart adları otomatik eşleşir.`);
    const unk = items.filter(o => o.unknown).length;
    if (unk) warnings.push(`${unk} satırın kategorisini satıcı adından çıkaramadım, “Diğer” olarak geldi.`);
    const plain = items.filter(i => !/taksit\)/.test(i.note)).map(i => i.date).sort();
    return { bank: bank || "Kart", statementDate: null, period: { from: plain[0] || null, to: docDate }, previousBalance: null, payments: null, statementDebt: null,
      items: items.map(({ unknown, ...o }) => o), skipped, warnings, digits: last4 ? { [last4]: card } : {}, partial: true, offline: true };
  }

  // Credit-handling shared by card parsers: attach refunds/discounts to purchases, cancel exact refunds.
  function settle(debits, credits, out, skipped, opts) {
    const sameKey = (a, k) => k && merchantKey(a.desc) === k;
    for (const c of credits) {
      const amt = -c.amount, key = merchantKey(c.desc);
      const exact = key && debits.filter(d => !d.cancelled && sameKey(d, key) && Math.abs(d.amount + (d.adj || 0) - amt) < 0.005).sort((a, b) => gap(a.date, c.date) - gap(b.date, c.date))[0];
      if (exact) { exact.cancelled = true; skipped.push({ desc: `${exact.desc} + iadesi`, amount: amt, reason: "aynı tutarla tamamen iade edildi" }); continue; }
      const cand = key ? debits.filter(d => !d.cancelled && sameKey(d, key) && d.amount + (d.adj || 0) > amt && gap(d.date, c.date) <= 31)
        .sort((a, b) => (a.date <= c.date ? 0 : 1) - (b.date <= c.date ? 0 : 1) || gap(a.date, c.date) - gap(b.date, c.date)) : [];
      if (cand[0]) { const t = cand[0]; t.adj = r2((t.adj || 0) - amt); t.notes = (t.notes || []).concat(`${amt.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} iade`); continue; }
      const k = classify(c.desc, opts.history);
      out.push({ date: c.date, card: c.card, amount: c.amount, desc: c.desc, cat: k.cat, note: niceName(c.desc) + " (iade/indirim)" });
    }
  }
  function moveTaksit(date, n, from, to) {
    if (!from || !to || n < 2 || (date >= from && date <= to)) return date;
    const day = Number(date.slice(8, 10));
    for (const base of [from, to]) { const [y, m] = base.split("-").map(Number); const dim = new Date(y, m, 0).getDate(); const c = `${y}-${pad(m)}-${pad(Math.min(day, dim))}`; if (c >= from && c <= to) return c; }
    return to;
  }

  // DenizBank kredi kartı: tutar satır sonunda "1,234.56 TL", alacaklar "1,234.56+ TL"
  function parseDeniz(lines, opts) {
    const all = lines.join("\n");
    const g = re => { const m = all.match(re); return m ? Number(m[1].replace(/,/g, "")) : null; };
    const kesim = grabDate(lines, /HESAP KESIM TARIHI\s*:?\s*(\d{2})[.\/](\d{2})[.\/](\d{4})/);
    const pm = all.match(/Ekstre Dönemi\s+(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    const from = pm ? iso(pm[1], pm[2], pm[3]) : (kesim ? addDays(addMonths(kesim, -1), 1) : null);
    const prev = g(/Önceki Hesap Bakiyeniz\s+([\d,]+\.\d{2})/i), debt = g(/Dönem Borcu\s+([\d,]+\.\d{2})/i);
    let card = "DenizBank"; const digits = {}; const d0 = all.match(/Kart Numarası\s+[\d* ]*?(\d{4})\b/i); if (d0) digits[d0[1]] = card;
    const debits = [], credits = [], fees = [], skipped = []; let payments = 0;
    for (const line of lines) {
      const f = fold(line);
      const ek = f.match(/EK KART NO\s*:?\s*[\d* ]*?(\d{4})\s*$/); if (ek) { card = "DenizBank Ek Kart"; digits[ek[1]] = card; continue; }
      const m = line.match(/^\s*(\d{2})\/(\d{2})\/(\d{4})\s+(.*)$/); if (!m) continue;
      const date = iso(m[1], m[2], m[3]);
      const am = m[4].match(/([\d,]+\.\d{2})(\+)?\s*TL\s*$/); if (!am) continue;
      const amount = r2(Number(am[1].replace(/,/g, ""))), credit = !!am[2];
      let rest = m[4].slice(0, am.index);
      const tk = rest.match(/Peş\.?\s*Taksit\s*(\d+)\.Tk.*?\/(\d+)-(\d+)/i);
      const fxm = rest.match(/([\d.]+)\s+(USD|EUR|GBP)\b/);
      let desc = rest.replace(/Peş\.?\s*Taksit.*$/i, "").replace(/\s{3,}[\d.,]+(\/\d+-\d+)?\s*/g, "   ").replace(/\s+\d{6,}\s+\d{3}\s*$/, "").split(/\s{3,}/).filter(x => x && !/^[\d.,\/-]+$/.test(x) && !/^(USD|EUR|GBP)$/.test(x)).join(" ").replace(/\s+[\d.]+\s+(USD|EUR|GBP)\s*$/, "").trim();
      const fd = fold(desc);
      if (/HESAPTAN ODEME|ODEMENIZ|OTOMATIK ODEME/.test(fd) && credit) { payments = r2(payments + amount); continue; }
      if (/FAIZ|BSMV|KKDF|UYELIK UCRETI|KART UCRETI/.test(fd)) { fees.push({ date, amount: credit ? -amount : amount }); continue; }
      const item = { date, card, desc, amount: credit ? -amount : amount, taksit: tk ? { n: Number(tk[1]), of: Number(tk[2]) } : null, fx: fxm ? `${fxm[2]} ${fxm[1].replace(".", ",")}` : "" };
      (credit ? credits : debits).push(item);
    }
    const out = [];
    settle(debits, credits, out, skipped, opts);
    for (const d of debits) {
      if (d.cancelled) continue; const amount = r2(d.amount + (d.adj || 0)); if (Math.abs(amount) < 0.005) continue;
      let { cat, note, unknown } = classify(d.desc, opts.history);
      if (d.taksit) note += ` (${d.taksit.n}/${d.taksit.of} taksit)`;
      if (d.fx) note += ` (${d.fx})`; if (d.notes) note += d.notes.length > 2 ? ` (${d.notes.length} iade düşüldü)` : ` (${d.notes.join(", ")})`;
      out.push({ date: d.taksit ? moveTaksit(d.date, d.taksit.n, from, kesim) : d.date, card: d.card, amount, desc: d.desc, cat, note: note.slice(0, 80), biz: /SGK|VERGI|V\.D\.|GIB\.GOV/.test(fold(d.desc)), unknown: !!unknown });
    }
    if (fees.length) out.push({ date: kesim || fees[0].date, card: "DenizBank", amount: r2(fees.reduce((s, x) => s + x.amount, 0)), desc: "Faiz", cat: "Diğer", note: "Kart faizi ve vergileri (DenizBank)" });
    out.sort((a, b) => a.date.localeCompare(b.date));
    const warnings = []; const unk = out.filter(o => o.unknown).length;
    if (unk) warnings.push(`${unk} satırın kategorisini satıcı adından çıkaramadım, “Diğer” olarak geldi. İstersen listede değiştir.`);
    return { bank: "DenizBank", statementDate: kesim, period: { from, to: kesim }, previousBalance: prev, payments, statementDebt: debt,
      items: out.map(({ unknown, ...o }) => o), skipped, warnings, digits, offline: true };
  }

  // Vadesiz hesap hareketleri (İş Bankası biçimi): sadece gerçek harcamalar alınır.
  // Kendi hesapları arası aktarım, kart borcu ödemesi, döviz alımı ve gelen para harcama sayılmaz.
  function parseHesap(lines, opts) {
    const all = lines.join("\n"), F = fold(all);
    const holder = ((all.match(/Sayın\s+([A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜa-zçğıöşü ]+?)\s{2,}|Sayın\s+([A-ZÇĞİÖŞÜ ]+)$/m) || []).slice(1).find(Boolean) || "").trim();
    const H = fold(holder);
    const bank = /ISBANK|IS BANKASI|ISCEP/.test(F) ? "İş Bankası" : /DENIZBANK/.test(F) ? "DenizBank" : /QNB/.test(F) ? "QNB" : "Banka";
    const card = bank + " hesap";
    const pr = all.match(/Tarih Aralığı:\s*(\d{2})\.(\d{2})\.(\d{4}).*?-\s*(\d{2})\.(\d{2})\.(\d{4})/i);
    const items = [], skipped = []; let pre = [], started = false, incoming = 0, inN = 0;
    const why = d => /HESAPLAR ARASI/.test(d) || (H && d.includes(H)) || /\*BEN\*/.test(d) ? "kendi hesapları arası aktarım"
      : /KRE\.?\s*KART BORC|KREDI KARTI BORC|KART BORC ODEME/.test(d) ? "kredi kartı borcu ödemesi (harcamalar kart ekstresinden gelir)"
      : /DOVIZ ALIS\//.test(d) || (/DOVIZ ALIS/.test(d) && !/KMV/.test(d)) ? "döviz alımı (harcama değil, birikim)"
      : /YATIRIM HESABI(?! SAKLAMA)|FON ALIS|HISSE ALIS/.test(d) ? "yatırım" : null;
    for (const line of lines) {
      const f = fold(line);
      if (/TARIH\/SAAT/.test(f)) { started = true; pre = []; continue; }
      if (!started) continue;
      if (/^\(\*\)|CEKILEN TUTAR|SAYFA \d/.test(f)) { pre = []; continue; }
      const m = line.match(/^\s*(\d{2})\/(\d{2})\/(\d{4})-\d{2}:\d{2}:\d{2}\s+(.*)$/);
      if (!m) { pre.push(line.trim()); continue; }
      const date = iso(m[1], m[2], m[3]);
      const toks = m[4].split(/\s{3,}/).map(t => t.trim()).filter(Boolean);
      const ai = toks.findIndex(t => /^-?\d{1,3}(\.\d{3})*,\d{2}$/.test(t)); if (ai < 0) { pre = []; continue; }
      const amount = r2(num(toks[ai], true));
      const tail = toks.slice(ai + 2).join(" ").replace(/^0,00\s+[A-Z0-9]{2}\s+(FAST|EFT|Para Çekme|Para Transferi|Döviz|Yatırım|Havale)?\s*/i, "");
      const desc = (pre.join(" ") + " " + tail).replace(/\s+/g, " ").trim(); pre = [];
      const d = fold(desc);
      if (amount > 0) { incoming = r2(incoming + amount); inN++; continue; }
      const out = -amount, w = why(d);
      if (w) { skipped.push({ desc: desc.slice(0, 70), amount: out, reason: w }); continue; }
      let cat = "Diğer", note;
      if (/KMV|DVZ ALIS/.test(d)) note = "Döviz alım komisyonu";
      else if (/UCRET/.test(d) && out < 200) note = /SAKLAMA/.test(d) ? "Yatırım hesabı saklama ücreti" : "Havale/FAST ücreti";
      else if (/SAKLAMA/.test(d)) note = "Yatırım hesabı saklama ücreti";
      else {
        const pm = desc.match(/^(?:.*?\*)?\s*([A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ .]+?)\s*\*\s*TR\d{2}[\d ]{10,}\*([^*]*)/);
        const who = pm ? pm[1].trim() : "", what = pm ? pm[2].trim() : "";
        const k = classify(what || desc, opts.history);
        cat = /MUHASEBE|\bPR\b|KURGU|CEKIM|PRODUKSIYON|STYLING|AJANS|TASARIM|ORGANIZASYON|DANISMANLIK|HIZMET BEDELI/.test(fold(what)) ? "İş" : (k.unknown ? "Diğer" : k.cat);
        const low = t => t.split(" ").map(w => /[İŞĞÜÖÇ]/.test(w) ? w.toLocaleLowerCase("tr") : w.toLowerCase()).join(" ").replace(/(^|\s)(\p{L})/gu, (x, a, b) => a + (b === "i" ? "İ" : b.toLocaleUpperCase("tr")));
        note = who ? `${low(who)}${what ? " · " + low(what).replace(/\s*Bedeli$/i, "") : ""}` : niceName(desc);
      }
      items.push({ date, card, amount: out, desc, cat, note: note.slice(0, 80), biz: /SGK|VERGI|V\.D\./.test(d) });
    }
    if (!items.length && !skipped.length) return { error: "Bu hesap dökümünde harcama satırı bulunamadı." };
    items.sort((a, b) => a.date.localeCompare(b.date));
    const warnings = [`Bu bir banka hesabı dökümü. Kendi hesapların arası aktarımlar, kredi kartı borcu ödemeleri ve döviz alımları harcama sayılmadı (aşağıda listelendi). ${inN} gelen para (${incoming.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL) alınmadı.`,
      "Kişilere yapılan havaleler de harcama olarak eklendi; adı belli olmayanlar “Diğer” kategorisinde."];
    return { bank, statementDate: null, period: { from: pr ? iso(pr[1], pr[2], pr[3]) : (items[0] || {}).date, to: pr ? iso(pr[4], pr[5], pr[6]) : null }, previousBalance: null, payments: null, statementDebt: null,
      items, skipped, warnings, digits: {}, partial: true, account: true, offline: true };
  }

  const titleTr = t => String(t).trim().split(/\s+/).map(w => /[İŞĞÜÖÇışğüöç]/.test(w) ? w.toLocaleLowerCase("tr") : w.toLowerCase()).join(" ")
    .replace(/(^|\s)(\p{L})/gu, (x, a, b) => a + (b === "i" ? "İ" : b.toLocaleUpperCase("tr")));

  // QNB vadesiz hesap hareketleri: uzun açıklamalar tarih satırının üstüne ve altına taşar.
  function parseHesapQnb(lines, opts) {
    const all = lines.join("\n");
    const holder = ((all.match(/Ad Soyad\s*:\s*([^\n]+?)\s*$/m) || [])[1] || "").trim(), H = fold(holder);
    const pr = all.match(/Tarih Aralığı\s*:\s*(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    const acct = ((all.match(/Hesap Adı\s*:\s*(.+?)(\s{3,}|$)/m) || [])[1] || "").trim();
    const card = "QNB hesap";
    const MON = /^-?\d{1,3}(,\d{3})*\.\d{2}$/;
    const HEAD = /^(TRANSFER|YATIRIM|MEVDUAT|ODEME|KART|KREDI|DOVIZ|FATURA|DIGER|EFT|HAVALE)\s+ISLEMLERI/;
    const rows = []; let pre = [], started = false;
    for (const line of lines) {
      const f = fold(line).trim();
      if (/ISLEM TARIHI\s+KANAL/.test(f)) { started = true; continue; }
      if (!started || !f || /^SAYFA:|^BU DOKUMAN|^\*SB:|^[ΓΘ]$|DEVREDEN BAKIYE/.test(f)) continue;
      const m = line.match(/^\s*(\d{2})\/(\d{2})\/(\d{4})\s+(.*)$/);
      if (m) {
        const toks = m[4].split(/\s{3,}|\s(?=-?\d{1,3}(?:,\d{3})*\.\d{2}(?:\s|$))/).map(t => t.trim()).filter(Boolean);
        const mi = toks.map((t, i) => MON.test(t) ? i : -1).filter(i => i >= 0);
        if (mi.length < 2) { pre = []; continue; }
        const ai = mi[mi.length - 2];
        const inline = toks.slice(0, ai).filter((t, i) => !(i === 0 && /^[A-ZÇĞİÖŞÜ]{2,5}$/.test(t))).join(" ");
        rows.push({ date: iso(m[1], m[2], m[3]), amount: r2(num(toks[ai], false)), parts: [...pre, inline] }); pre = [];
      } else if (HEAD.test(f) || !rows.length) pre.push(line.trim());
      else rows[rows.length - 1].parts.push(line.trim());
    }
    const items = [], skipped = []; let inN = 0, incoming = 0; const fees = [], mkk = [];
    for (const r of rows) {
      const desc = r.parts.join(" ").replace(/\s+/g, " ").trim(), d = fold(desc);
      if (r.amount > 0) { inN++; incoming = r2(incoming + r.amount); continue; }
      const out = -r.amount;
      const alici = (desc.match(/Alıcı\s*:\s*(.+?)(?:\s+(?:Türkiye|Kuveyt|Enpara|Denizbank|Türk Ekonomi|Ziraat|QNB|Akbank|Yapı|Garanti|Halk|ING|Şekerbank|Odeabank|Fibabanka|Vakıf)\b|-|\s+Sorgu|$)/i) || [])[1] || "";
      const aliciDesc = (desc.match(/Alıcı\s*:[^-]+-(.+?)\s+Al\.Hs/i) || [])[1] || "";
      const own = H && fold(alici).replace(/\s+/g, " ") === H.replace(/\s+/g, " ");
      const why = own || /HESAPLAR ARASI|VADELI HESABA GIDEN|NAKIT PARA GIRISI|HESAPTAN HESABA HAVALE/.test(d) && (own || /ALICI\s*:?\s*/.test(d) ? own || !alici : true) ? "kendi hesapları arası aktarım"
        : /FON ALIS|HISSE ALIS|FON SATIS/.test(d) && !/UCRETI/.test(d) ? (/STOPAJ/.test(d) ? "fon satışı stopajı (yatırım getirisinden kesilen vergi)" : "yatırım fonu alımı")
        : /KART ODEMESI|KART BORC|KREDI KARTI/.test(d) ? "kredi kartı borcu ödemesi (harcamalar kart ekstresinden gelir)"
        : /BORC GERI ODEME|BORC ODEME|ELDEN BORC/.test(d) ? "borç geri ödemesi" : null;
      if (why) { skipped.push({ desc: desc.slice(0, 80), amount: out, reason: why }); continue; }
      if (/MEVDUAT ISLEMLERI/.test(d) && /FAIZ|KKDF|BSMV/.test(d)) { fees.push({ date: r.date, amount: out }); continue; }
      if (/MKK|SAKLAMA UCRETI|BAKIM UCRETI|ALIM\/SATIM UCRETI/.test(d)) { mkk.push({ date: r.date, amount: out }); continue; }
      let cat = "Diğer", note;
      if (/ODEME ISLEMLERI/.test(d)) {
        const who = desc.replace(/^.*?Ödeme İşlemleri\s*-\s*[\d ]*-\s*/i, "").replace(/\s*(TAHSİLATI|tahsilatı).*$/i, "").trim();
        const k = classify(who, opts.history); cat = k.unknown ? "Faturalar" : k.cat; note = k.unknown ? titleTr(who) : k.note;
      } else if (alici) {
        const k = classify(alici + " " + aliciDesc, opts.history);
        cat = k.unknown ? "Diğer" : k.cat;
        note = `Havale: ${titleTr(alici.replace(/\s+(A\.?Ş\.?|LTD\.?\s*ŞTİ\.?|TİC\.?.*)$/i, ""))}${aliciDesc ? " · " + aliciDesc.trim() : ""}`;
      } else { const k = classify(desc, opts.history); cat = k.cat; note = k.note; }
      items.push({ date: r.date, card, amount: out, desc, cat, note: note.slice(0, 80), biz: /SGK|VERGI|V\.D\./.test(d) });
    }
    if (fees.length) items.push({ date: fees[fees.length - 1].date, card, amount: r2(fees.reduce((s, x) => s + x.amount, 0)), desc: "Ek hesap faizi", cat: "Diğer", note: "Ek hesap faizi ve vergileri (QNB)" });
    if (mkk.length) items.push({ date: mkk[mkk.length - 1].date, card, amount: r2(mkk.reduce((s, x) => s + x.amount, 0)), desc: "MKK ücretleri", cat: "Diğer", note: "Yatırım hesabı ücretleri (MKK)" });
    items.sort((a, b) => a.date.localeCompare(b.date));
    const warnings = [`Bu bir banka hesabı dökümü${acct ? " (" + acct + ")" : ""}. Kendi hesapların arası aktarımlar, yatırım alım-satımları, kart borcu ödemeleri ve borç geri ödemeleri harcama sayılmadı (aşağıda listelendi). ${inN} gelen para alınmadı.`,
      "Kişilere yapılan havaleler de harcama olarak eklendi; adı belli olmayanlar “Diğer” kategorisinde."];
    return { bank: "QNB", statementDate: null, period: { from: pr ? iso(pr[1], pr[2], pr[3]) : null, to: pr ? iso(pr[4], pr[5], pr[6]) : null }, previousBalance: null, payments: null, statementDebt: null,
      items, skipped, warnings, digits: {}, partial: true, account: true, offline: true };
  }

  function parseStatement(pages, opts) {
    opts = opts || {};
    const lines = pages.flat().map(l => String(l).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ""));
    const text = lines.join("\n");
    const FT = fold(text);
    if (/DONEM ICI HAREKETLER/.test(FT)) return parseDonemIci(lines, opts);
    if (/HESAP HAREKETLERI/.test(FT) && /IBAN/.test(FT) && /ISLEM TARIHI\s+KANAL/.test(FT)) return parseHesapQnb(lines, opts);
    if (/IBAN/.test(FT) && /TARIH\/SAAT/.test(FT) && /KANAL\/SUBE|ISLEM TUTARI/.test(FT) && !/KREDI KARTI HESAP OZETI/.test(FT)) return parseHesap(lines, opts);
    if (/DENIZBANK/.test(FT) && /EKSTRE DONEMI/.test(FT)) return parseDeniz(lines, opts);
    const B = detectBank(text);
    const money = B.tr ? MONEY_TR : MONEY_EN;
    const warnings = [], skipped = [];
    const kesim = grabDate(lines, /HESAP KESIM TARIHI\s*:?\s*(\d{2})[.\/](\d{2})[.\/](\d{4})/);
    const pFrom = kesim ? addDays(addMonths(kesim, -1), 1) : null;

    let prev = null, debt = null;
    if (B.card === "VakıfBank") { prev = grabAmount(lines, /ONCEKI DONEM HESAP OZETI BAKIYENIZ|ONCEKI HESAP BAKIYESI/, false); debt = grabAmount(lines, /DONEM BORCUNUZ/, false); }
    else if (B.card === "QNB") { prev = grabAmount(lines, /NCEKI D.?NEM BAKIYENIZ/, false); debt = grabAmount(lines, /^D.?NEM BORCU\s*:/, false); }
    else if (B.card === "Maximiles" || B.card === "Maximum") { prev = grabAmount(lines, /ONCEKI HESAP OZETI BAKIYENIZ/, true); debt = grabAmount(lines, /HESAP OZETI BORCU/, true); }

    // 1) Satırları ham işlemlere çevir
    const raw = []; let card = B.card, hints = []; const digits = {};
    const lastDesc = [];
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]; const f = fold(line);
      if (B.card === "QNB" && /SANAL KART\s*:/.test(f)) { card = "QNB Sanal"; const d4 = f.match(/(\d{4})\b(?!.*\d{4})/); if (d4) digits[d4[1]] = card; }
      if (B.card === "QNB" && /ASIL KART\s*:/.test(f)) { card = "QNB"; const d4 = f.match(/\*+\s*(\d{4})/); if (d4) digits[d4[1]] = card; }
      if ((B.card === "Maximum" || B.card === "Maximiles") && /SANAL KART NO/.test(f)) { card = B.card + " Sanal"; const d4 = f.match(/(\d{4})\s+[A-Z]/); if (d4) digits[d4[1]] = card; continue; }
      if (B.card !== "QNB") { const d4 = f.match(/KART (?:NO|NUMARASI)\s*:?\s*[\d*\s]*?(\d{4})\s*$/); if (d4) digits[d4[1]] = B.card; }
      const m = line.match(/^\s*(\d{2})[.\/](\d{2})[.\/](\d{4})\s+(.*)$/);
      if (!m) continue;
      const date = iso(m[1], m[2], m[3]);
      const toks = m[4].split(/\s{3,}/).map(t => t.trim()).filter(Boolean);
      // Maximiles: "indirim nedeniyle iptal edilen mil: X SATICI" → indirimin hangi harcamaya ait olduğu ipucu
      if (/IPTAL EDILEN MAXIMIL/.test(f)) {
        const after = fold(m[4]).replace(/.*MAXIMIL:\s*[\d.,]+\s*/, "") + " " + fold(lines[li + 1] || "");
        hints.push({ date, key: merchantKey(after), eats: /EATS/.test(after), used: false }); continue;
      }
      let ai = toks.findIndex((t, i) => i > 0 && money.test(t));
      if (ai < 0 && toks.length && money.test(toks[0])) ai = 0;
      if (ai < 1) { if (!/MAXIPUAN|MAXIMIL/.test(f) && toks.length) { /* tutarsız satır: genelde bilgi notu */ } continue; }
      const desc = toks.slice(0, ai).join(" ").trim();
      const fd = fold(desc);
      let amount = num(toks[ai], B.tr);
      const rest = toks.slice(ai + 1).join(" ");
      if (/MAXIPUAN|MAXIMIL ILAVE|SADAKAT PROGRAM/.test(fd)) { continue; }
      if (/ONCEKI DONEM|NCEKI D.?NEM BAKIYE|ONCEKI HESAP OZETI/.test(fd)) continue;
      if (/ODEMENIZ ICIN|DEME - TESEKK|ODEME - TESEKK|HESAPTAN AKTARIM|OTOMATIK ODEME|ODEMENIZ/.test(fd)) { raw.push({ kind: "payment", date, amount: Math.abs(amount), desc }); continue; }
      // VakıfBank alacakları "+" ile, QNB/Maximiles "-" ile yazar
      const credit = /^\+/.test(toks[ai]) || amount < 0;
      if (credit) amount = -Math.abs(amount);
      let taksit = null;
      const tq = rest.match(/^(\d{1,2})\/(\d{1,2})\b/) || desc.match(/(\d{1,2})\.\s*TAKS[İI]T/i) && [null, desc.match(/(\d{1,2})\.\s*TAKS[İI]T/i)[1], null];
      if (tq) taksit = { n: Number(tq[1]), of: tq[2] ? Number(tq[2]) : null };
      const fxm = desc.match(/\((USD|EUR|GBP)\s*([\d.,]+)\)/i), fxs = desc.match(/([\d.,]+)\s+(USD|EUR|GBP)\s+SATI/i);
      const fx = fxm ? [fxm[0], fxm[1], fxm[2]] : fxs ? [fxs[0], fxs[2], fxs[1]] : [];
      const isFee = /FAIZ|FAIZI|BSMV|KKDF|KART UCRETI|YILLIK UCRET|GECIKME/.test(fd) && !/FAIZSIZ/.test(fd);
      raw.push({ kind: isFee ? "fee" : credit ? "credit" : "debit", date, amount, desc: desc.replace(/\s*-eski kart/i, ""), card, taksit, fx: fx[1] ? `${fx[1].toUpperCase()} ${fx[2].replace(".", ",")}` : "", line: li, used: false });
    }
    if (!raw.length) return { error: "Bu PDF'te harcama satırı bulunamadı. Kart ekstresi olduğundan emin ol." };

    const payments = r2(raw.filter(r => r.kind === "payment").reduce((s, r) => s + r.amount, 0));
    const debits = raw.filter(r => r.kind === "debit");
    const credits = raw.filter(r => r.kind === "credit");
    const fees = raw.filter(r => r.kind === "fee");

    // 2) İade ve indirimleri harcamalara bağla
    const out = [];
    const sameKey = (a, k) => k && merchantKey(a.desc) === k;
    for (const c of credits) {
      const fd = fold(c.desc), amt = -c.amount;
      let key = merchantKey(c.desc), target = null, eats = false;
      const generic = /^(BLACK |)?(RESTORAN|OTOPARK)?\s*INDIRIM$|^BLACK .*INDIRIM|^[\d.,]+ ALSV IND|ALSV IND|^INDIRIM$/.test(fd) || /^(INDIRIM|ALSV)/.test(key) || key === "BLACK";
      if (generic) {
        const h = hints.find(h => !h.used && h.date >= c.date && gap(h.date, c.date) <= 3);
        if (h) { h.used = true; key = h.key; eats = h.eats || /RESTORAN/.test(fd); }
        else { // isimsiz indirim: aynı gün hemen önceki harcama
          const before = debits.filter(d => d.line < c.line && d.date === c.date); target = before[before.length - 1] || null; }
      } else if (/INDIRIM/.test(fd)) key = merchantKey(c.desc.replace(/INDIRIM|İndirim/ig, ""));
      if (!target && key && !/GLOBALBLUE|GLOBAL BLUE|TAX ?FREE/.test(fold(c.desc))) {
        // Tam iptal: aynı satıcı, tutar ≤1 TL farkla
        const exact = debits.filter(d => !d.cancelled && sameKey(d, key) && Math.abs(d.amount - amt) < 1 && gap(d.date, c.date) <= 31)
          .sort((a, b) => (a.card === c.card ? 0 : 1) - (b.card === c.card ? 0 : 1) || gap(a.date, c.date) - gap(b.date, c.date))[0];
        if (exact && !generic) {
          exact.cancelled = true; c.used = true;
          const resid = r2(exact.amount - amt);
          skipped.push({ desc: `${exact.desc} + iadesi`, amount: exact.amount, reason: resid ? `iade edildi, ${resid.toFixed(2).replace(".", ",")} fark aynı satıcının başka harcamasından düşüldü` : "aynı tutarla tamamen iade edildi" });
          if (resid) { const o = debits.filter(d => !d.cancelled && sameKey(d, key)).sort((a, b) => gap(a.date, c.date) - gap(b.date, c.date))[0]; if (o) { o.adj = r2((o.adj || 0) + resid); o.notes = (o.notes || []).concat(`${Math.abs(resid).toFixed(2).replace(".", ",")} iade farkı düşüldü`); } else out.push({ date: c.date, card: c.card, amount: resid, desc: c.desc + " (iade farkı)", cat: "Diğer", note: niceName(c.desc) + " (iade farkı)" }); }
          continue;
        }
        const cand = debits.filter(d => !d.cancelled && sameKey(d, key) && d.amount + (d.adj || 0) > amt && gap(d.date, c.date) <= 7);
        cand.sort((a, b) => (a.card === c.card ? 0 : 1) - (b.card === c.card ? 0 : 1) || (a.date <= c.date ? 0 : 1) - (b.date <= c.date ? 0 : 1) || gap(a.date, c.date) - gap(b.date, c.date) || a.line - b.line);
        if (generic) cand.sort((a, b) => (a.date <= c.date ? 0 : 1) - (b.date <= c.date ? 0 : 1) || gap(a.date, c.date) - gap(b.date, c.date) || b.amount - a.amount);
        target = cand[0] || null;
      }
      if (target) {
        target.adj = r2((target.adj || 0) - amt);
        target.notes = (target.notes || []).concat(`${amt.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${/IADE|REFUND/.test(fd) || /PERAKENDE|GETIR|STEAM|APPLE/.test(fold(target.desc)) && !/INDIRIM/.test(fd) ? "iade" : "indirim"}`);
        if (eats) target.eats = true;
        c.used = true;
      } else {
        const tax = /GLOBALBLUE|GLOBAL BLUE|TAX ?FREE/.test(fold(c.desc));
        out.push({ date: c.date, card: c.card, amount: c.amount, desc: c.desc, cat: tax ? "Alışveriş" : classify(c.desc, opts.history).cat,
          note: tax ? `Tax-free iadesi, Global Blue${c.fx ? " (" + c.fx + ")" : ""}` : niceName(c.desc) + " (iade/indirim)" });
      }
    }

    // 3) Harcamalar
    const winFrom = kesim ? addDays(addMonths(kesim, -1), 1) : null;
    for (const d of debits) {
      if (d.cancelled) continue;
      const amount = r2(d.amount + (d.adj || 0));
      if (Math.abs(amount) < 0.005) continue;
      let { cat, note, unknown } = classify(d.eats ? "UBER EATS" : d.desc, opts.history);
      let date = d.date;
      if (d.taksit) {
        note += d.taksit.of ? ` (${d.taksit.n}/${d.taksit.of} taksit)` : ` (${d.taksit.n}. taksit)`;
        // Eski bir alışverişin taksiti: bu ekstrenin dönemine, aynı gün numarasına taşı
        if (winFrom && d.taksit.n > 1 && (date < winFrom || date > kesim)) {
          const day = Number(date.slice(8, 10));
          let cand = null;
          for (const base of [winFrom, kesim]) { const [y, m] = base.split("-").map(Number); const dim = new Date(y, m, 0).getDate(); const c = `${y}-${pad(m)}-${pad(Math.min(day, dim))}`; if (c >= winFrom && c <= kesim) { cand = c; break; } }
          date = cand || kesim;
        }
      }
      if (d.fx) note += ` (${d.fx})`;
      if (d.notes) note += d.notes.length > 2 ? ` (${d.notes.length} iade düşüldü)` : ` (${d.notes.join(", ")})`;
      out.push({ date, card: d.card, amount, gross: d.adj ? r2(d.amount) : undefined, desc: d.desc, cat, note: note.slice(0, 80), biz: /SGK|VERGI|V\.D\.|GIB\.GOV/.test(fold(d.desc)), unknown: !!unknown });
    }
    // 4) Faiz + vergiler tek kalem
    if (fees.length) {
      const total = r2(fees.reduce((s, f) => s + f.amount, 0));
      const cardName = B.card === "QNB" ? "QNB" : B.card;
      out.push({ date: kesim || fees[fees.length - 1].date, card: cardName, amount: total, desc: fees.map(f => f.desc).join(" + "), cat: "Diğer", note: `Kart faizi ve vergileri (${B.bank || cardName})` });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    if (B.unknown) warnings.push("Bu bankanın ekstre biçimini tanımıyorum. Satırları genel kurala göre okudum, kategorileri ve toplamı mutlaka kontrol et.");
    const unk = out.filter(o => o.unknown).length;
    if (unk) warnings.push(`${unk} satırın kategorisini satıcı adından çıkaramadım, “Diğer” olarak geldi. İstersen listede değiştir.`);
    const firstPlain = debits.filter(d => !d.taksit && (!kesim || d.date <= kesim)).map(d => d.date).sort()[0];
    const from = [pFrom, firstPlain].filter(Boolean).sort()[0] || null;
    return { bank: B.bank || "Kart", statementDate: kesim, period: { from, to: kesim }, previousBalance: prev, payments, statementDebt: debt,
      items: out.map(({ unknown, ...o }) => o), skipped, warnings, digits, offline: true };
  }

  root.EkstreOku = { parseStatement, fold, merchantKey, niceName, classify, CATS };
})(typeof window !== "undefined" ? window : globalThis);
