
function escPdf(text: string) {
  return text.replace(/[()\\]/g, " ").slice(0, 88);
}

function miniPdf(filename: string, title: string, lines: string[]): File {
  const cmds = [`BT /F1 16 Tf 54 730 Td (${escPdf(title)}) Tj /F1 11 Tf 0 -22 Td`];
  for (const line of lines) {
    cmds.push(`(${escPdf(line)}) Tj T*`);
  }
  cmds.push("ET");
  const stream = cmds.join(" ");
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj",
    `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj`,
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj",
  ];
  const bytes = `%PDF-1.1\n${objects.join("\n")}\ntrailer<< /Root 1 0 R >>\n%%EOF`;
  return new File([bytes], filename, { type: "application/pdf" });
}

function md(name: string, text: string) {
  return new File([text], name, { type: "text/markdown" });
}

function txt(name: string, text: string) {
  return new File([text], name, { type: "text/plain" });
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    data[i] += n;
    data[i + 1] += n;
    data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function paintPhoto(filename: string, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): Promise<File> {
  const w = 960;
  const h = 720;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(new File([], filename, { type: "image/jpeg" }));
  draw(ctx, w, h);
  grain(ctx, w, h);
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(new File([blob ?? new Blob()], filename, { type: "image/jpeg" })),
      "image/jpeg",
      0.86,
    );
  });
}

async function stockPhoto(
  filename: string,
  url: string,
  fallback: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): Promise<File> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4500);
    const res = await fetch(url, { signal: controller.signal, mode: "cors" });
    window.clearTimeout(timer);
    if (!res.ok) throw new Error("fetch");
    const blob = await res.blob();
    if (blob.size < 2000) throw new Error("empty");
    return new File([blob], filename, { type: blob.type || "image/jpeg" });
  } catch {
    return paintPhoto(filename, fallback);
  }
}

function paintFish(ctx: CanvasRenderingContext2D, w: number, h: number, body: string, fin: string) {
  const water = ctx.createLinearGradient(0, 0, 0, h);
  water.addColorStop(0, "#134e6a");
  water.addColorStop(0.55, "#1b6b7a");
  water.addColorStop(1, "#0c3344");
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  for (let i = 0; i < 18; i++) {
    ctx.beginPath();
    ctx.ellipse(80 + i * 52, 40 + ((i * 37) % 160), 30, 140, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(w * 0.52, h * 0.55, 210, 86, -0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fin;
  ctx.beginPath();
  ctx.moveTo(w * 0.32, h * 0.55);
  ctx.lineTo(w * 0.18, h * 0.38);
  ctx.lineTo(w * 0.2, h * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#f4f0e6";
  ctx.beginPath();
  ctx.arc(w * 0.68, h * 0.5, 8, 0, Math.PI * 2);
  ctx.fill();
}

function paintCrate(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#6a5340";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#8b6a4a";
  ctx.fillRect(80, 160, w - 160, h - 240);
  const silver = ["#c4b8a4", "#9aa7a0", "#d2c6b0"];
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = silver[i % silver.length];
    ctx.beginPath();
    ctx.ellipse(180 + (i % 3) * 200, 280 + Math.floor(i / 3) * 110, 78, 28, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintMarket(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#f2d2b0");
  sky.addColorStop(1, "#c56a3c");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#2c2118";
  ctx.fillRect(0, h * 0.62, w, h * 0.38);
  ctx.fillStyle = "#7a2e24";
  ctx.fillRect(120, 220, 240, 230);
  ctx.fillStyle = "#d9a13a";
  ctx.fillRect(400, 260, 220, 190);
  ctx.fillStyle = "#3f6b3a";
  ctx.fillRect(660, 240, 200, 210);
}

function paintKitchen(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#e8ddd0";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#c9b29a";
  ctx.fillRect(0, h * 0.58, w, h * 0.42);
  ctx.fillStyle = "#8a8f94";
  ctx.fillRect(80, 80, w - 160, 240);
  ctx.fillStyle = "#1f1f1f";
  ctx.fillRect(200, 420, 280, 36);
  ctx.fillStyle = "#b42318";
  ctx.beginPath();
  ctx.arc(620, 470, 54, 0, Math.PI * 2);
  ctx.fill();
}

function paintHarbor(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#8eb6d4");
  sky.addColorStop(0.45, "#f0e4c8");
  sky.addColorStop(1, "#2d5c72");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#1d3a4a";
  ctx.fillRect(140, 300, 36, 220);
  ctx.fillStyle = "#c45a2a";
  ctx.beginPath();
  ctx.moveTo(158, 180);
  ctx.lineTo(280, 340);
  ctx.lineTo(40, 340);
  ctx.closePath();
  ctx.fill();
}

function shuffleFiles(files: File[]): File[] {
  const next = files.slice();
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = next[i];
    next[i] = next[j];
    next[j] = swap;
  }
  return next;
}

export async function createSampleFiles(): Promise<File[]> {
  const images = await Promise.all([
    stockPhoto(
      "atlantic-cod.jpg",
      "https://images.unsplash.com/photo-1535591273668-578e31182c4f?auto=format&fit=crop&w=960&q=70",
      (ctx, w, h) => paintFish(ctx, w, h, "#e07a28", "#f0c36a"),
    ),
    stockPhoto(
      "mackerel-school.jpg",
      "https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=960&q=70",
      (ctx, w, h) => paintFish(ctx, w, h, "#3d6b7a", "#9ec9c4"),
    ),
    stockPhoto(
      "salmon-crate.jpg",
      "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=960&q=70",
      paintCrate,
    ),
    stockPhoto(
      "saturday-market.jpg",
      "https://images.unsplash.com/photo-1488459716781-31db52582fe9?auto=format&fit=crop&w=960&q=70",
      paintMarket,
    ),
    stockPhoto(
      "kitchen-prep.jpg",
      "https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&w=960&q=70",
      paintKitchen,
    ),
    stockPhoto(
      "gloucester-harbor.jpg",
      "https://images.unsplash.com/photo-1468413253725-0d5181091126?auto=format&fit=crop&w=960&q=70",
      paintHarbor,
    ),
  ]);

  return shuffleFiles([
    miniPdf("nws-boston-tuesday.pdf", "Weather forecast — Tuesday 2 September", [
      "Boston / Cape Ann. Issued 5:40 a.m. EDT",
      "Today: sun, then a sea breeze. High 74. Wind SW 8 to 14 mph.",
      "Tonight: clear. Low 58. Small craft advisory ends at 8 p.m.",
      "Wednesday: fog early, then fair. High 71.",
      "Thursday: showers arriving after noon. High 66.",
      "Marine: seas 2 to 4 ft. Visibility 6 miles.",
    ]),
    md(
      "weekly-outlook.md",
      `# Weather weekly outlook
## Week of 1 September
Monday stayed dry. Tuesday is the last warm afternoon before a front.
Wednesday morning fog on the Annisquam. Thursday rain, 0.4 in possible.
Friday clearing, good for the harbor market. Weekend: high 68, light chop.
`,
    ),
    txt(
      "frost-watch.txt",
      `Weather frost watch
Inland only, not the coast.
Petersham and Gardner may see 36° after midnight Thursday.
Cover basil. Harbor lots stay above 48. Cancelled the truck to Worcester.
`,
    ),
    miniPdf("standup-agenda.pdf", "Meeting notes — Monday standup", [
      "Harbor Fish Co.  kitchen  ·  8:15 a.m.  ·  8 Sept",
      "1. Weekend tickets: Saturday crushed, Sunday was soft.",
      "2. Cod delayed out of Portland. Use hake for the lunch special.",
      "3. Invoice 1842 still unpaid. Maya chasing accounting.",
      "4. Gloucester trip Friday: camera + cooler, back by 4.",
      "Actions: reprint the chalkboard. Confirm ice delivery.",
    ]),
    md(
      "service-notes.md",
      `# Meeting Saturday floor notes
## Harbor Fish Co.
Covers 142. Waited 25 minutes on two four-tops after 7:30.
Guests asked for the miso cod twice after we 86'd it.
Bar was fine. One complaint on the chowder — too thick, noted.
Comp'd dessert on table 11. Tip average 19%.
`,
    ),
    txt(
      "action-items.txt",
      `Meeting action items
Call Portland about Wednesday's skate.
Email Maya the unpaid invoice.
Order more deli paper before the market.
Ask Luis if he can open Thursday.
`,
    ),
    miniPdf("invoice-1842.pdf", "Invoice 1842 — Harbor Fish Co.", [
      "From: North Shore Ice & Fish  ·  Gloucester, MA",
      "Bill to: Harbor Fish Co.  ·  14 Commercial St",
      "14 lb Atlantic cod  ·  $11.40/lb  ·  $159.60",
      "8 lb mackerel  ·  $6.20/lb  ·  $49.60",
      "Ice, crushed, 4 bags  ·  $28.00",
      "Total due 15 September  ·  $237.20",
      "Terms: net 14. Leave the check with the dock office.",
    ]),
    md(
      "invoice-receipt.md",
      `# Invoice paid receipt
## Market stall 12
Saturday 6 September. Cash box + Square.
Whole mackerel 22 lb. Lemons, parsley, two bags of ice.
Taken: $186.40. Square fees $5.22. Net $181.18.
Slip in the tin by the register.
`,
    ),
    md(
      "miso-cod.md",
      `# Recipe miso black cod
Overnight cure, then a hot broiler.
Marinate overnight: white miso, mirin, sugar, a little sake.
Fish in at 400° for 10 minutes, then broil until the edges catch.
Serve with pickled cucumber and rice. We 86'd this Saturday — make more marinade.
Do not salt before the cure. It tightens the flesh.
`,
    ),
    md(
      "chowder.md",
      `# Recipe haddock chowder
Sweat onion and celery in butter. No flour if we can help it — reduce the stock.
Add diced potato, then the fish at the end so it flakes, not boils.
Cream off heat. Chives, black pepper, oyster crackers on the side.
Saturday's batch ran thick. Use one less potato next time.
`,
    ),
    miniPdf("gloucester-itinerary.pdf", "Travel itinerary — Gloucester Friday", [
      "Leave the shop 6:30 a.m.  ·  back by 4 p.m.",
      "7:45  North Shore Ice & Fish, pick up invoice 1842 fish.",
      "9:30  Harbor walk, photos for the Saturday board.",
      "11:00  Coffee with Dana about the winter stall.",
      "1:00  Pack the cooler. Ice at the dock, not the gas station.",
      "Bring: camera, cash, the scale, two extra totes.",
    ]),
    txt(
      "packing-list.txt",
      `Travel packing list
Cooler, two gel packs, the analog scale.
Camera and the charged battery.
Cash for the dock office.
Rain jacket — Thursday looks wet if we slip to Friday.
Do not forget Dana's number. It is on the invoice.
`,
    ),
    ...images,
  ]);
}
