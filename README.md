# LittleLibrary

**Drop files onto an infinite plane. They file themselves by topic.**

You open an empty wall. You drop PDFs, notes, photos, and videos, or you click **try the samples**. The page parses each file in the browser and stacks the pending clips in an intake pile. A hand labeled WebMCP reads the occupancy grid, picks a clip, and carries it to a topic section. Weather, meetings, invoices, recipes, travel, and photos become packed neighborhoods you can pan, drag, and inspect. The human UI and the agent write the same clips, tiles, slots, and topics.

[Live demo](https://littlelibrary.j8vpkjs9pw.workers.dev/) · [Source](https://github.com/Saivion/LittleLibrary) · License: [MIT](./LICENSE)

No login. Open the live URL in **ChatGPT’s in-app browser** or **Chrome with WebMCP enabled**.

There is no “WebMCP on” footer. Confirm the host is attached by the hand label (`WebMCP` plus a tool name such as `place_tile`), and in the console:

```js
document.modelContext && (await document.modelContext.getTools()).map((t) => t.name)
// get_occupancy, place_tile, place_batch, cluster_visible
```

Without a host, **try the samples** still files through the same `execute` functions.

---

## The problem

A week of work is a mixed pile: forecasts, standup notes, invoices, recipes, trip photos. Folders hide that mix. Chat AI files it by returning a tag list or a markdown dump. You cannot see a placement succeed. You cannot walk the result. You cannot drag one card while something else is still being filed. The model never sees the wall you are looking at, so it cannot share occupancy with you.

That is the job LittleLibrary takes. The wall is the filing room. People drop files and steer. Agents place tiles through site tools. Both meet on the same clips, slots, and topics.

---

## Why this is a strong fit for WebMCP

WebMCP is for when the page is the environment the model acts in, not a remote API with chat bolted on.

LittleLibrary is that environment. The intake pile, the occupancy grid, the topic homes, and the packed wall all live in the browser. An agent should not invent pixel coordinates or dump a folder tree. It should speak the page language: clip ids, occupancy slot ids (`"3,-1"`), topics (`weather`, `invoice`, `images`), and pending clips from the current viewport.

`document.modelContext.registerTool` is the write path. The human UI, the built-in filing loop, and an attached host agent all call the same executes. If a host cannot see the tools, it cannot place a tile. That is the point of WebMCP: the site is the capability surface.

---

## How it is a better experience

Typical “AI files my stuff” demos are opaque. The model returns a tag list or a markdown dump. You cannot see a placement succeed, you cannot walk a wall, and a second agent has no shared occupancy to honor.

Here the loop is visible and collaborative:

1. **Slots, not pixels.** Tools take `clipId` and `slotId`. Never `x,y`.
2. **Topics own neighborhoods.** Each topic has a home. Cards pack into an organic section. Occupancy slots stay the agent record.
3. **The hand is the chrome.** It shows `WebMCP` and the live tool (`place_tile`, `waiting`). You watch the write path.
4. **The human stays on the wall.** Pan, zoom, drag a card, marquee-select, open the inspector. The next `get_occupancy` sees what you changed.
5. **Same executes with or without a host.** Drop files or try the samples. `callTool` uses the host when `document.modelContext` is attached, otherwise `executeNamedTool` in the page.

---

## What people and agents can do together

Things that were awkward or impossible when the model only had a chat box and a file:

| Together | Why it needed WebMCP |
| --- | --- |
| You drop a mixed pile; the agent files each clip into a topic section | Pending clips and empty slots are page state, not a chat summary |
| You pan to a section while a card is in the hand | Occupancy is viewport-scoped. The agent works the wall you are looking at |
| You drag a card; the next `get_occupancy` returns the new map | One store. Human drag commits a slot. Tools read that slot |
| You open a card in the inspector while filing continues | Inspector reads a tile. Tools still mutate pending clips and occupancy |
| A host agent calls `place_batch` or `cluster_visible` on the same wall | Those tools are registered on the document, not hidden in the renderer |
| You click **try the samples**; six topic homes are reserved before the first place | Sample topics (`weather`, `meeting`, `invoice`, `recipe`, `travel`, `images`) are the same keys `place_tile` clusters on |

Humans act in the UI. Agents act with tools. Both land on clips, tiles, occupancy slots, and topics in `src/lib/store.ts`. The agent should not import `src/lib/pack.ts`, `src/lib/layout.ts`, or the wall renderer.

---

## How WebMCP is implemented

On load, `PlaneApp` calls `registerPlaneTools()` in [`src/lib/webmcp.ts`](src/lib/webmcp.ts). Tools register on **`document.modelContext` only**. There is no `navigator.modelContext` fallback.

Definitions and executes live in [`src/lib/tools.ts`](src/lib/tools.ts). Each `registerTool` call uses the real `name`, `description`, and `inputSchema` from `TOOL_DEFS`, plus `execute: (input) => executeNamedTool(name, input)`.

```js
document.modelContext.registerTool({
  name: "place_tile",
  description:
    "Place one pending clip onto an empty occupancy slot. clipId comes from get_occupancy.next. Optional slotId must be an empty occupancy slot from get_occupancy. If omitted, the page chooses the nearest empty slot to the current viewport, clustered by the clip topic. If the slot is taken, the next empty neighbor is used. Never stacks. Never pass pixel coordinates.",
  inputSchema: {
    type: "object",
    properties: {
      clipId: {
        type: "string",
        description: "Pending clip id from get_occupancy.next",
      },
      slotId: {
        type: "string",
        description: 'Occupancy slot id like "3,-1". Never pixel x,y.',
      },
    },
    required: ["clipId"],
    additionalProperties: false,
  },
  execute: async (input) => executeNamedTool("place_tile", input),
});
```

The same shape is used for every tool. Registration also passes `annotations` and an `AbortSignal` so leaving the page unregisters the tools.

**Lifecycle the built-in agent runs** ([`src/lib/agent.ts`](src/lib/agent.ts)):

```
get_occupancy
  → pick a pending clipId (prefer a different topic than the last drop)
  → reach the intake pile
  → grab the card
  → carry it to the packed destination
  → place_tile({ clipId, slotId? })
  → repeat until pending === 0
```

`callTool` prefers `document.modelContext.executeTool` when the host lists the tool. If no host is attached, it calls `executeNamedTool` in the page. Ingest (`src/lib/ingest.ts`) ends with `scheduleOrganize()` → `kickAgent()`, so **try the samples** and file drop use that same path.

`place_batch` and `cluster_visible` are registered for a host agent. The built-in loop does not call them.

---

## Try it (judges)

**Live:** [https://littlelibrary.j8vpkjs9pw.workers.dev/](https://littlelibrary.j8vpkjs9pw.workers.dev/)

Hosted on Cloudflare Workers. No auth.

1. Open the URL in ChatGPT’s in-app browser, or Chrome with WebMCP.
2. Confirm WebMCP: hand label, or `document.modelContext.getTools()` as above.
3. Prompt a host agent: *“File the intake pile. Use get_occupancy, then place_tile for each pending clip. Speak slot ids, not pixels.”*
4. Human action: pan the wall, drag a card to another neighborhood, or click a card to open the inspector.
5. There is no share or export. State is in-memory. The hero copy is accurate: nothing is kept or stored.

Without a WebMCP host, click **try the samples**. The built-in agent still runs `get_occupancy` → `place_tile` through the same executes.

---

## Tools

Agents never see pixel `x,y`. They speak clip ids, slot ids, and topics.

### Read

| Tool | Role |
| --- | --- |
| `get_occupancy` | Viewport occupancy only. Returns `center`, nearby empty slot ids, occupied tiles `{id, slot, topic, title}`, `pending` count, and `next` pending clips `{id, topic, title}`. Capped to ~1500 characters. |

### Write

| Tool | Role |
| --- | --- |
| `place_tile` | Place one pending `clipId` on an empty `slotId`, or let the page pick a slot by topic. Never stacks. |
| `place_batch` | Up to 8 `place_tile` calls in one store emit. Same occupancy rules. |
| `cluster_visible` | Regroup visible tiles by topic into nearby empty slots. Moves at most 8 tiles. |

---

## Run locally

```bash
npm install          # also copies pdf.js worker → public/pdf.worker.min.mjs
npm run dev          # http://localhost:3000
npm run build        # static export → ./out
npm run lint
npm run cf:preview   # build + wrangler dev
npx wrangler login && npm run cf:deploy
```

---

## Stack

- **Next.js** 16.3.4 + **React** 19
- **TypeScript**
- **Tailwind** 4
- **pdfjs-dist** for PDF text and first-page posters
- **lucide-react** for a few marks
- **webmcp-types** for `document.modelContext`
- **Instrument Serif** + **Inter** via `next/font`

State is module stores (`src/lib/store.ts`, `src/lib/camera.ts`), not Zustand. Tools live in `src/lib/tools.ts`. Registration lives in `src/lib/webmcp.ts`. The wall in `src/components/` only reads state.

---

## License

[MIT](./LICENSE) for the application source. GitHub already detects this file as MIT in About.

### Asset credits

- Sample photographs are fetched from [Unsplash](https://unsplash.com/license) when the network allows, with generated canvas fallbacks if the fetch fails. URLs are in `src/lib/samples.ts` (`atlantic-cod.jpg`, `mackerel-school.jpg`, `salmon-crate.jpg`, `saturday-market.jpg`, `kitchen-prep.jpg`, `gloucester-harbor.jpg`).
- Sample PDFs, markdown, and text files are generated in that same module.
- UI fonts: Instrument Serif and Inter (Google Fonts).
- PDF parsing: Mozilla pdf.js.

---

## Contest checklist

| Requirement | Status |
| --- | --- |
| Working live URL judges can open in ChatGPT or Chrome + WebMCP | **Met.** [https://littlelibrary.j8vpkjs9pw.workers.dev/](https://littlelibrary.j8vpkjs9pw.workers.dev/) |
| Auth | **Met.** None. |
| Text: why WebMCP, better UX, people + agents, how implemented | **Met.** Sections above, in that order. |
| Demo video (public YouTube, under 3 minutes) | **Missing.** No video URL in the repo. |
| Public repo with source, assets, run instructions | **Missing (public).** Repo is [Saivion/LittleLibrary](https://github.com/Saivion/LittleLibrary), currently **private**. Source and run instructions are in this README. Local clone has no `git remote` configured. |
| OSI license at repo root, visible in GitHub About | **Met.** `LICENSE` is MIT. GitHub reports `license.key: mit`. |
| `document.modelContext.registerTool({ name, description, inputSchema, execute })` in the README | **Met.** `place_tile` snippet above, copied from `src/lib/tools.ts` / `src/lib/webmcp.ts`. |
