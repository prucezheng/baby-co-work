import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const sourcePath = path.join(rootDir, "mobile_function_layout_prototype.svg");
const outDir = path.join(rootDir, "design", "mobile-ui-screens");

const screens = [
  {
    page: 1,
    slug: "01-todo",
    title: "待办",
    notes: "status bar, title actions, priority filters, task cards, knowledge capture block, add placeholder, fixed bottom tabs, assistant FAB",
  },
  {
    page: 2,
    slug: "02-calendar",
    title: "日历",
    notes: "agent sync banner, date strip, calendar import, agent scheduling, grouped task agenda, fixed bottom tabs, assistant FAB",
  },
  {
    page: 3,
    slug: "03-contribution",
    title: "贡献",
    notes: "profile controls, yearly contribution heatmap, achievement badges, family contribution ranking, fixed bottom tabs, assistant FAB",
  },
  {
    page: 4,
    slug: "04-agent",
    title: "Agent",
    notes: "assistant identity, segmented control, plan answer card, video/RAG upload card, ingest flow, safety warning, fixed bottom tabs, assistant FAB",
  },
];

function extractDefs(source) {
  const match = source.match(/<defs>[\s\S]*?<\/defs>/);
  if (!match) {
    throw new Error("Could not find SVG <defs> block.");
  }
  return match[0];
}

function extractPageGroup(source, pageNumber) {
  const startMarker = `<!-- Page ${pageNumber} -->`;
  const endMarker = pageNumber === 4 ? "<!-- Bottom architecture notes -->" : `<!-- Page ${pageNumber + 1} -->`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  if (start === -1 || end === -1) {
    throw new Error(`Could not find page ${pageNumber} boundaries.`);
  }

  const segment = source.slice(start + startMarker.length, end).trim();
  const lines = segment.split("\n");
  const firstGroupLine = lines.findIndex((line) => line.includes("<g ") && line.includes("scale(0.86)"));
  const lastGroupLine = lines.length - 1 - [...lines].reverse().findIndex((line) => line.trim() === "</g>");

  if (firstGroupLine === -1 || lastGroupLine <= firstGroupLine) {
    throw new Error(`Could not unwrap page ${pageNumber} group.`);
  }

  return lines
    .slice(firstGroupLine + 1, lastGroupLine)
    .map((line) => line.replace(/^    /, "  "))
    .join("\n");
}

function standaloneSvg({ title, notes, slug, body, defs }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="430" height="900" viewBox="0 0 430 900">
  <title>育儿协作台 - ${title}界面</title>
  <desc>Editable modular UI export: ${notes}.</desc>
${defs
  .split("\n")
  .map((line) => `  ${line}`)
  .join("\n")}
  <rect width="430" height="900" rx="0" fill="#f4f5f7"/>
  <g id="${slug}-screen" transform="translate(20 28)">
${body}
  </g>
</svg>
`;
}

async function renderPng(browser, svgPath, pngPath) {
  const page = await browser.newPage({
    viewport: { width: 430, height: 900 },
    deviceScaleFactor: 2,
  });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:430px;height:900px;background:#f4f5f7;overflow:hidden;}img{display:block;width:430px;height:900px;}</style></head><body><img src="${pathToFileURL(svgPath).href}" alt=""></body></html>`,
    { waitUntil: "load" },
  );
  await page.screenshot({ path: pngPath, fullPage: false });
  await page.close();
}

await fs.mkdir(outDir, { recursive: true });

const source = await fs.readFile(sourcePath, "utf8");
const defs = extractDefs(source);
const outputs = [];

for (const screen of screens) {
  const body = extractPageGroup(source, screen.page);
  const svg = standaloneSvg({ ...screen, body, defs });
  const svgPath = path.join(outDir, `${screen.slug}.svg`);
  await fs.writeFile(svgPath, svg, "utf8");
  outputs.push({ ...screen, svgPath, pngPath: path.join(outDir, `${screen.slug}.png`) });
}

const systemChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let launchOptions = {};
try {
  await fs.access(systemChromePath);
  launchOptions = { executablePath: systemChromePath };
} catch {
  launchOptions = {};
}

const browser = await chromium.launch(launchOptions);
try {
  for (const output of outputs) {
    await renderPng(browser, output.svgPath, output.pngPath);
  }
} finally {
  await browser.close();
}

for (const output of outputs) {
  console.log(`${output.title}: ${path.relative(rootDir, output.pngPath)} | ${path.relative(rootDir, output.svgPath)}`);
}
