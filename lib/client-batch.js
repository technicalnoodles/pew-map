function addConnectionToClientBatch(client, connection, maxVisual) {
  client.totalCount += 1;

  if (client.buffer.length < maxVisual) {
    client.buffer.push(connection);
    return;
  }

  const replacementIndex = Math.floor(Math.random() * client.totalCount);
  if (replacementIndex < maxVisual) {
    client.buffer[replacementIndex] = connection;
  }
}

function drainClientBatch(client) {
  const batch = {
    totalCount: client.totalCount,
    visual: client.buffer
  };

  client.totalCount = 0;
  client.buffer = [];
  return batch;
}

module.exports = { addConnectionToClientBatch, drainClientBatch };
