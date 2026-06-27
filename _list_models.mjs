import { AcpClient } from "./acp/acpClient.js";

const client = new AcpClient();
try {
  await client.start();
  console.log(JSON.stringify(client.models.map((m) => ({ id: m.modelId, name: m.name })), null, 2));
  console.log("current:", client.currentModel);
} finally {
  client.stop();
}
