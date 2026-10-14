// Serves dealership logos uploaded in setup, stored in Netlify Blobs.

import { getStore } from "@netlify/blobs";
import { getDb } from "../lib/crm.mjs";

export const LOGO_STORE = "dealership-logos";

export default async (request) => {
  try {
    const id = new URL(request.url).searchParams.get("d");
    if (!id) return new Response("Not found", { status: 404 });
    const [dealership] = await getDb().sql`SELECT logo_key FROM carnova_dealerships WHERE id = ${id}`;
    if (!dealership?.logo_key) return new Response("Not found", { status: 404 });
    const result = await getStore(LOGO_STORE).getWithMetadata(dealership.logo_key, { type: "arrayBuffer" });
    if (!result) return new Response("Not found", { status: 404 });
    return new Response(result.data, {
      headers: {
        "content-type": result.metadata?.contentType || "image/png",
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Logo lookup failed", error.message);
    return new Response("Logo unavailable", { status: 500 });
  }
};
