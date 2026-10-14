// ADF (Auto-lead Data Format) XML parser. ADF is the industry standard lead
// email format sent by CRMs like dealr.cloud and ProMax and by third-party
// lead providers. The format is small and well defined, so a focused parser
// avoids pulling an XML dependency into every function bundle.

const decodeEntities = (value) =>
  String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .trim();

const stripTags = (value) => decodeEntities(String(value ?? "").replace(/<(?!!\[CDATA\[)[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** All <tag ...>inner</tag> blocks (case-insensitive) with parsed attributes. */
const blocks = (xml, tag) => {
  const pattern = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  return [...String(xml ?? "").matchAll(pattern)].map((match) => ({
    attrs: Object.fromEntries(
      [...String(match[1] ?? "").matchAll(/([a-z_:-]+)\s*=\s*"([^"]*)"/gi)].map(
        (attr) => [attr[1].toLowerCase(), attr[2]],
      ),
    ),
    inner: match[2],
  }));
};

const first = (xml, tag) => blocks(xml, tag)[0] ?? null;
const textOf = (xml, tag) => {
  const block = first(xml, tag);
  return block ? stripTags(block.inner) : "";
};

/** Pulls the <adf> document out of an email body or attachment. */
export const extractAdfXml = (content) => {
  const text = String(content ?? "");
  const match = text.match(/<adf[\s>][\s\S]*?<\/adf>/i);
  if (match) return match[0];
  // Some senders HTML-escape the XML inside an HTML email body.
  const unescaped = text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  return unescaped.match(/<adf[\s>][\s\S]*?<\/adf>/i)?.[0] ?? null;
};

const contactName = (contact) => {
  const names = blocks(contact, "name");
  const full = names.find((name) => name.attrs.part === "full");
  if (full) return stripTags(full.inner);
  const firstName = names.find((name) => name.attrs.part === "first");
  const lastName = names.find((name) => name.attrs.part === "last");
  const combined = [firstName, lastName].filter(Boolean).map((name) => stripTags(name.inner)).join(" ");
  return combined || (names[0] ? stripTags(names[0].inner) : "");
};

const pickPhone = (contact) => {
  const phones = blocks(contact, "phone");
  const preferred =
    phones.find((phone) => /cell|mobile/i.test(phone.attrs.type || "")) ??
    phones.find((phone) => /voice/i.test(phone.attrs.type || "")) ??
    phones[0];
  return preferred ? stripTags(preferred.inner) : "";
};

/**
 * Parses an ADF document into one lead per <prospect>. Returns
 * { leads: [...], errors: [...] }; a document with no usable prospect yields
 * an error instead of throwing.
 */
export const parseAdf = (content) => {
  const xml = extractAdfXml(content);
  if (!xml) return { leads: [], errors: ["No ADF <adf> document found."] };
  const prospects = blocks(xml, "prospect");
  if (!prospects.length) return { leads: [], errors: ["ADF document has no <prospect>."] };

  const leads = [];
  const errors = [];
  prospects.forEach((prospect, index) => {
    const customer = first(prospect.inner, "customer")?.inner ?? "";
    const contact = first(customer, "contact")?.inner ?? "";
    const vehicleBlock = first(prospect.inner, "vehicle");
    const vehicle = vehicleBlock?.inner ?? "";
    const vendor = first(prospect.inner, "vendor")?.inner ?? "";
    const provider = first(prospect.inner, "provider")?.inner ?? "";

    const name = contactName(contact);
    const email = textOf(contact, "email").toLowerCase();
    const phone = pickPhone(contact);
    const vehicleParts = [textOf(vehicle, "year"), textOf(vehicle, "make"), textOf(vehicle, "model"), textOf(vehicle, "trim")].filter(Boolean);
    const providerName = textOf(provider, "name") || textOf(provider, "service");

    if (!name && !email && !phone) {
      errors.push(`Prospect ${index + 1} has no customer name, email, or phone.`);
      return;
    }
    leads.push({
      name: name || email || phone,
      email: email || null,
      phone: phone || null,
      vehicleInterest: vehicleParts.join(" ") || null,
      vehicle: {
        interest: vehicleBlock?.attrs.interest || null,
        status: vehicleBlock?.attrs.status || null,
        year: textOf(vehicle, "year") || null,
        make: textOf(vehicle, "make") || null,
        model: textOf(vehicle, "model") || null,
        trim: textOf(vehicle, "trim") || null,
        vin: textOf(vehicle, "vin") || null,
        stock: textOf(vehicle, "stock") || null,
      },
      tradeIn: (() => {
        const trade = blocks(prospect.inner, "vehicle").find((block) => block.attrs.interest === "trade-in");
        return trade ? [textOf(trade.inner, "year"), textOf(trade.inner, "make"), textOf(trade.inner, "model")].filter(Boolean).join(" ") || null : null;
      })(),
      comments: textOf(customer, "comments") || null,
      requestDate: textOf(prospect.inner, "requestdate") || null,
      vendorName: textOf(vendor, "vendorname") || null,
      provider: providerName || null,
      source: providerName ? `adf:${providerName}`.slice(0, 120) : "adf_email",
    });
  });
  return { leads, errors };
};

export const SAMPLE_ADF = `<?xml version="1.0" encoding="UTF-8"?>
<?adf version="1.0"?>
<adf>
  <prospect status="new">
    <requestdate>2026-09-26T10:15:00-05:00</requestdate>
    <vehicle interest="buy" status="used">
      <year>2022</year><make>Toyota</make><model>Tacoma</model><trim>TRD Off-Road</trim>
    </vehicle>
    <customer>
      <contact>
        <name part="first">Test</name><name part="last">Lead</name>
        <email>test.lead@example.com</email>
        <phone type="cellphone">5555550100</phone>
      </contact>
      <comments>This is a NovaCar connection test lead. Is it still available?</comments>
    </customer>
    <vendor><vendorname>NovaCar Test Dealership</vendorname></vendor>
    <provider><name part="full">NovaCar connection test</name></provider>
  </prospect>
</adf>`;
