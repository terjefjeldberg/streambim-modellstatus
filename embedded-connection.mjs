// StreamBIM panels still initiate Penpal 6 (syn / synAck / ack).
// Prefer that handshake in a panel; the v7 widget SDK handles standalone viewers.
export async function connectEmbedded({sdk,legacy,parentWindow,referrer,callbacks}) {
  const parentOrigin=referrer?new URL(referrer).origin:/^https:\/\/(?:[a-z0-9-]+\.)*streambim\.com(?::\d+)?$/i;
  if(legacy?.connectToParent) {
    const connection=legacy.connectToParent({parentOrigin,methods:callbacks,timeout:10000});
    try {sdk.API=await connection.promise;return connection;}
    catch(error){connection.destroy();if(error.code!=='ConnectionTimeout')throw error;}
  }
  await sdk.connectToParent(parentWindow,callbacks);
  return sdk._connection;
}
