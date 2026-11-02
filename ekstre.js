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
  const PREFIX = /^(IYZICO|PAYCELL|TAMI?-?ODEME|TAM-?ODEME|TAM ODEME|YEMEKPAY|TKPAY|PAYTR( ODEME)?|PARAT|S|REFUND|DL)\s*\/?\s*/;
  function merchantKey(desc) {
    let s = fold(desc).replace(/-ESKI KART/g, "").replace(/\(.*?\)/g, " ");
    for (let i = 0; i < 3; i++) s = s.replace(PREFIX, "");
    s = s.replace(/^\*+/, "");
    const w = (s.match(/[A-Z]{3,}/) || [""])[0];
    return w.replace(/(\d+)$/, "");
  }

  // Kategori ve okunur isim kuralları (sıra önemli: ilk eşleşen kazanır)
  const RULES = [
    [/YEMEKSEPETI|YEMEKPAY/, "Yemek", "Yemeksepeti"], [/UBER\s*\*?\s*EATS|UBER EATS/, "Yemek", "Uber Eats"],
    [/STARBUCKS|SBUX|SBX /, "Yemek", "Starbucks"], [/GETIR/, "Market", "Getir"], [/MIGROS|MGROS/, "Market", "Migros"],
    [/A101|BIM |SOK MARKET|CARREFOUR|MACROCENTER|METRO /, "Market", null],
    [/LIME/, "Ulaşım", "Lime scooter"], [/BITAKSI|MOKAUNTED/, "Ulaşım", "BiTaksi"], [/BOLT/, "Ulaşım", "Bolt"], [/UBER/, "Ulaşım", "Uber"],
    [/TIKTAK|TKTAKKRALA|TIKTAKKIRALA/, "Ulaşım", "TikTak araç kiralama"], [/HOP SCOOT|HOP SCOOTER/, "Ulaşım", "Hop scooter"],
    [/HGS/, "Ulaşım", "HGS yükleme"], [/VALE/, "Ulaşım", "Vale"], [/PETROL|OPET|SHELL|\bBP\b|AKARYAKIT|TOTAL ENERJI/, "Ulaşım", null],
    [/OTOPARK|TAYA YOLCU|ISPARK/, "Ulaşım", null], [/OTOMOTIV/, "Ulaşım", null],
    [/TKPAY \/ AJET|AJET/, "Seyahat", "AJet"], [/TURKISH AIRLINES|TKPAY|THY/, "Seyahat", "THY"], [/PEGASUS/, "Seyahat", "Pegasus"],
    [/HILTON|HOTEL|OTEL/, "Seyahat", null], [/LOUNGE IST|PPL LOUNGE|HAVA ?LIMANI|HAVALIMANI/, "Seyahat", null], [/LOUNGE|BAR |PUB |CLUB/, "Eğlence", null], [/TURIZM|TOUR/, "Seyahat", null],
    [/APPLE\.COM|APPLE COM\/BILL/, "Faturalar", "Apple abonelik"], [/SIGORTA/, "Faturalar", null], [/TURKCELL|VODAFONE|TURK TELEKOM|TT NET/, "Faturalar", null],
    [/ISKI|IGDAS|ELEKTRIK|ENERJISA|CK BOGAZICI/, "Faturalar", null],
    [/APSIYON|TESIS YONETIM|SITE YONETIM|AIDAT/, "Kira/Ev", null], [/IKEA|BAUHAUS|KOCTAS|ENGLISH HOME|VESTEL|MADAME COCO/, "Kira/Ev", null],
    [/ECZANE|ECZANESI|ACIBADEM|MEDIPOL|MLP SAGLIK|MEDICAL PARK|HASTANE|KLINIK|VETERINER|SUPPLEMENT/, "Sağlık", null],
    [/AV MALZEME|SAVUNMA|STEAM|PLAYSTATION|SPOTIFY|EXXEN|NETFLIX|PATREON|WEMOD|POLIGON|SINEMA|PARIBU|YOUTUBE/, "Eğlence", null],
    [/HIGGSFIELD|WAVES|OPENAI|ANTHROPIC|ADOBE|CANVA|NOTION/, "İş", null],
    [/KUAFOR|BERBER|LOSTRA|KOZMETIK|SEPHORA|GRATIS|WATSONS/, "Bakım", null],
    [/SGK|VERGI/, "Diğer", null],
    [/AY MARKA|TRENDYOL|HEPSIBURADA|AMAZON|BEYMEN|ZARA|PRADA|STONE|LA VALLEE|INTIMISSIMI|LULULEMON|SUPERSTEP|DECATHLON|TEKNOSA|MEDIAMARKT|APPLE STORE|KUYUM|MAGAZA|TEKSTIL|TEKST|STORE|SHOPIER|BOYNER|MAVI|LC WAIKIKI|UNIFREE|DUTY FREE|OFFENDER|NARKONTEKS|ADESA|POLISSEPETI|CRAFTLABEL|KRAFTCOVER/, "Alışveriş", null],
    [/LOKANTA|RESTORAN|RESTAURANT|OCAKBASI|KEBAP|KOFTE|DONER|BURGER|PIZZA|STEAKHOUSE|CAFE|KAFE|KAHVE|DONDURMA|BUFE|BALIK|CATERING|PASTANE|MIDPOINT|KANATCI|HAMSI|KASE NO|FINDIK OCAGI|SALONU|FIKO|HAMSIBURNU|AMBURNU|LILLO/, "Yemek", null],
    [/MARKET|GIDA|BAKKAL|CIFLIK|MANAV|KASAP|SARKUTERI|FIRINI|FIRIN|DENIZ URUN|GULMAR|GLMAR|KARMAR|^ER MAR|SECCO/, "Market", null],
  ];
  const NAMES = [[/TRENDYOL/, "Trendyol"], [/APSIYON/, "Apsiyon (site aidatı)"], [/ALLIANZ/, "Allianz sigorta"], [/QNB SIGORTA/, "QNB Sigorta"],
    [/TT NET/, "Türk Telekom internet"], [/TURKCELL/, "Turkcell"], [/ISKI/, "İSKİ su"], [/IGDAS/, "İGDAŞ doğalgaz"], [/ULUDAG ELEKTRIK/, "Uludağ Elektrik"],
    [/SGK/, "SGK prim ödemesi"], [/VERGI/, "Vergi ödemesi"], [/STEAM/, "Steam"], [/PLAYSTATION/, "PlayStation"], [/SPOTIFY/, "Spotify"], [/EXXEN/, "Exxen"],
    [/PATREON/, "Patreon"], [/WEMOD/, "WeMod Pro"], [/PARIBU/, "Paribu Pass"], [/OPENAI/, "OpenAI"], [/HIGGSFIELD/, "Higgsfield"], [/WAVES/, "Waves"],
    [/PRADA/, "Prada"], [/LA VALLEE STONE|STONE ISLAND/, "Stone Island"], [/BAUHAUS/, "Bauhaus"], [/BEYMEN/, "Beymen"], [/ZARA/, "Zara"], [/LULULEMON/, "Lululemon"],
    [/SUPERSTEP/, "Superstep"], [/DECATHLON/, "Decathlon"], [/INTIMISSIMI/, "Intimissimi"], [/TEKNOSA/, "Teknosa"], [/HILTON/, "Hilton otel"], [/SUPPLEMENTLER/, "Supplementler.com"],
    [/ACIBADEM/, "Acıbadem"], [/MEDIPOL/, "Medipol"], [/MLP SAGLIK/, "Medical Park"], [/VETERINER/, "Veteriner"], [/APPLE STORE/, "Apple Store"], [/A101/, "A101"],
    [/SHOPIER/, "Shopier"], [/POLISSEPETI/, "Polis Sepeti"], [/VESTEL/, "Vestel"], [/IKEA/, "IKEA"], [/ENGLISH HOME/, "English Home"], [/UNIFREE/, "Unifree"]];
  function niceName(desc) {
    const fd = fold(desc); for (const [re, n] of NAMES) if (re.test(fd)) return n;
    let s = String(desc).replace(/-eski kart/ig, "").replace(/\s*\((?:USD|EUR|GBP)[^)]*\)/ig, "");
    s = s.replace(/^(IYZICO|PAYCELL|TAMİ?-?ÖDEME|TAM-?ÖDEME|TAM ÖDEME|TAM-DEME|TAM DEME|YEMEKPAY|TKPAY|PAYTR( ODEME)?|PARAT|S|DL)\s*\/\s*/i, "");
    s = s.replace(/\/(İSTANBUL|ISTANBUL|TRABZON|İZMİR|IZMIR|BALIKESİR|BALIKESIR|ANKARA)\b.*$/i, "")
      .replace(/\s+(İSTANBUL|ISTANBUL|STANBUL|TRABZON)?\s*(TR|TU|NL|TRTR)$/i, "").replace(/\s+(İSTANBUL|ISTANBUL|STANBUL|TRABZON)$/i, "").replace(/\s+(İ?STANBUL|STANBUL)(\s+TR(TR)?)?$/i, "")
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

  function parseStatement(pages, opts) {
    opts = opts || {};
    const lines = pages.flat().map(l => String(l).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ""));
    const text = lines.join("\n");
    const B = detectBank(text);
    const money = B.tr ? MONEY_TR : MONEY_EN;
    const warnings = [], skipped = [];
    const kesim = grabDate(lines, /HESAP KESIM TARIHI\s*:?\s*(\d{2})[.\/](\d{2})[.\/](\d{4})/);
    const pFrom = kesim ? addDays(addMonths(kesim, -1), 1) : null;

    let prev = null, debt = null;
    if (B.card === "VakıfBank") { prev = grabAmount(lines, /ONCEKI DONEM HESAP OZETI BAKIYENIZ|ONCEKI HESAP BAKIYESI/, false); debt = grabAmount(lines, /DONEM BORCUNUZ/, false); }
    else if (B.card === "QNB") { prev = grabAmount(lines, /NCEKI D.?NEM BAKIYENIZ/, false); debt = grabAmount(lines, /^D.?NEM BORCU\s*:/, false); }
    else if (B.card === "Maximiles") { prev = grabAmount(lines, /ONCEKI HESAP OZETI BAKIYENIZ/, true); debt = grabAmount(lines, /HESAP OZETI BORCU/, true); }

    // 1) Satırları ham işlemlere çevir
    const raw = []; let card = B.card, hints = [];
    const lastDesc = [];
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]; const f = fold(line);
      if (B.card === "QNB" && /SANAL KART\s*:/.test(f)) card = "QNB Sanal";
      if (B.card === "QNB" && /ASIL KART\s*:/.test(f)) card = "QNB";
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
      const fx = (desc.match(/\((USD|EUR|GBP)\s*([\d.,]+)\)/i) || []);
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
          .sort((a, b) => gap(a.date, c.date) - gap(b.date, c.date))[0];
        if (exact && !generic) {
          exact.cancelled = true; c.used = true;
          const resid = r2(exact.amount - amt);
          skipped.push({ desc: `${exact.desc} + iadesi`, amount: exact.amount, reason: resid ? `iade edildi, ${resid.toFixed(2).replace(".", ",")} fark aynı satıcının başka harcamasından düşüldü` : "aynı tutarla tamamen iade edildi" });
          if (resid) { const o = debits.filter(d => !d.cancelled && sameKey(d, key)).sort((a, b) => gap(a.date, c.date) - gap(b.date, c.date))[0]; if (o) { o.adj = r2((o.adj || 0) + resid); o.notes = (o.notes || []).concat(`${Math.abs(resid).toFixed(2).replace(".", ",")} iade farkı düşüldü`); } else out.push({ date: c.date, card: c.card, amount: resid, desc: c.desc + " (iade farkı)", cat: "Diğer", note: niceName(c.desc) + " (iade farkı)" }); }
          continue;
        }
        const cand = debits.filter(d => !d.cancelled && sameKey(d, key) && d.amount + (d.adj || 0) > amt && gap(d.date, c.date) <= 7);
        cand.sort((a, b) => (a.date <= c.date ? 0 : 1) - (b.date <= c.date ? 0 : 1) || gap(a.date, c.date) - gap(b.date, c.date) || a.line - b.line);
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
      if (d.notes) note += ` (${d.notes.join(", ")})`;
      out.push({ date, card: d.card, amount, gross: d.adj ? r2(d.amount) : undefined, desc: d.desc, cat, note: note.slice(0, 80), biz: /SGK|VERGI/.test(fold(d.desc)), unknown: !!unknown });
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
      items: out.map(({ unknown, ...o }) => o), skipped, warnings, offline: true };
  }

  root.EkstreOku = { parseStatement, fold, merchantKey, niceName, classify, CATS };
})(typeof window !== "undefined" ? window : globalThis);
