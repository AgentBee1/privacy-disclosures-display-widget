const SUPABASE_URL = 'https://mtatzzrbapftzwuxrcko.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

async function sbFetch(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default async function handler(req, res) {
  // CORS — allow embedding from any origin (public widget)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // 1. All Awards & Recognition incidents — only the fields we need
    const incidents = await sbFetch(
      `incidents?report_type=eq.Awards%20%26%20Recognition` +
      `&select=id,incident_date,description,source_url` +
      `&order=incident_date.desc`
    );

    if (!incidents.length) {
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
      res.status(200).json({ awards: [] });
      return;
    }

    // 2. Agent details for each incident
    const agentRows = await sbFetch(
      `incidents?report_type=eq.Awards%20%26%20Recognition` +
      `&select=id,agents(id,agency_name,country,jurisdiction)`
    );
    const agentMap = {};
    agentRows.forEach(r => { agentMap[r.id] = r.agents; });

    // 3. Linked institutions (the issuing institutions)
    const idList = incidents.map(i => i.id).join(',');
    const instLinks = await sbFetch(
      `incident_institution_links?incident_id=in.(${idList})` +
      `&select=incident_id,institutions(id,name)`
    );
    const instMap = {};
    instLinks.forEach(l => {
      if (!l.institutions) return;
      if (!instMap[l.incident_id]) instMap[l.incident_id] = [];
      instMap[l.incident_id].push({ id: l.institutions.id, name: l.institutions.name });
    });

    // 4. Assemble — only expose what the widget needs, nothing sensitive
    const awards = incidents.map(inc => ({
      id:           inc.id,
      date:         inc.incident_date,
      description:  inc.description,
      source_url:   inc.source_url,
      agent:        agentMap[inc.id]
        ? {
            id:           agentMap[inc.id].id,
            agency_name:  agentMap[inc.id].agency_name,
            country:      agentMap[inc.id].country,
            jurisdiction: agentMap[inc.id].jurisdiction,
          }
        : null,
      institutions: instMap[inc.id] || [],
    }));

    // Cache for 5 minutes at the edge
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    res.status(200).json({ awards });

  } catch (e) {
    console.error('Awards API error:', e);
    res.status(500).json({ error: 'Failed to load awards data.' });
  }
}
