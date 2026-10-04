const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (statusCode, body) => ({
  statusCode,
  headers,
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const payload = JSON.parse(event.body || '{}');
    const { dealershipToken, make, model, year, color, minPrice, maxPrice, stock } = payload;

    if (!dealershipToken) {
      console.warn('Inventory query missing dealershipToken');
      return json(400, { error: 'Dealership token is required.' });
    }

    const queryParams = new URLSearchParams();
    if (make) queryParams.append('make', make);
    if (model) queryParams.append('model', model);
    if (year) queryParams.append('year', year);
    if (color) queryParams.append('color', color);
    if (minPrice) queryParams.append('minPrice', minPrice);
    if (maxPrice) queryParams.append('maxPrice', maxPrice);
    if (stock) queryParams.append('stock', stock);

    const url = `https://api.dealr.cloud/inventory?${queryParams.toString()}`;

    console.log(`[Inventory] Querying dealr.cloud for:`, {
      make, model, year, color, stock,
      priceRange: minPrice || maxPrice ? `$${minPrice || 'any'} - $${maxPrice || 'any'}` : 'any',
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${dealershipToken}`,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error(`[Inventory] dealr.cloud API error: ${response.status}`, errorBody.slice(0, 200));

      if (response.status === 401) {
        return json(401, {
          error: 'Dealership authentication failed. Session may have expired.',
          fallback: 'Let me connect you with our sales team to check inventory.',
        });
      }

      if (response.status === 404) {
        return json(200, {
          vehicles: [],
          message: 'No vehicles found matching those criteria. Would you like to explore other options?',
        });
      }


      return json(502, {
        error: 'Unable to reach the dealership inventory system.',
        fallback: 'Our inventory system is temporarily unavailable. Let me have a salesperson reach out with current availability.',
      });
    }

    const data = await response.json().catch(() => ({ vehicles: [] }));
    const vehicles = Array.isArray(data.vehicles) ? data.vehicles : data.data || [];

    console.log(`[Inventory] Found ${vehicles.length} matching vehicles`);

    const normalized = vehicles.slice(0, 10).map((v) => ({
      stock: v.stock_number || v.stock || 'N/A',
      year: v.year,
      make: v.make,
      model: v.model,
      color: v.color || 'Unknown',
      price: v.price ? `$${v.price.toLocaleString()}` : 'Call for price',
      mileage: v.mileage ? `${v.mileage.toLocaleString()} mi` : 'Unknown',
      location: v.location || 'In stock',
      url: v.url || '',
    }));

    return json(200, {
      count: normalized.length,
      vehicles: normalized,
      totalAvailable: vehicles.length,
    });
  } catch (error) {
    console.error('[Inventory] Function error:', error.message);
    return json(500, {
      error: 'Unable to check inventory at this time.',
      fallback: 'Let me get our sales team to help you find the right vehicle.',
    });
  }
};
