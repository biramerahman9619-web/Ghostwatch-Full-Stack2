export default async (req, context) => {
  const platform = req.headers.get('expo-platform');

  if (platform !== 'ios' && platform !== 'android') {
    return;
  }

  const manifestUrl = new URL(`/${platform}/manifest.json`, req.url);
  const manifestReq = new Request(manifestUrl, { headers: req.headers });
  const response = await context.nextRequest(manifestReq);
  const body = await response.text();

  return new Response(body, {
    status: response.status,
    headers: {
      'content-type': 'application/json',
      'expo-protocol-version': '1',
      'expo-sfv-version': '0',
    },
  });
};

export const config = {
  path: ['/', '/manifest'],
};
