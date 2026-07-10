const { createServer } = require("./remote-server/server");

const PORT = Number(process.env.PORT || 3000);
const server = createServer();

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`\n[Set Algorithm] Port ${PORT} is already in use.`);
    console.error(`Stop the existing server, or run: $env:PORT=3010; node server.js\n`);
    process.exitCode = 1;
    return;
  }

  throw error;
});

server.listen(PORT, () => {
  console.log("");
  console.log("============================================================");
  console.log("[Set Algorithm] Parent control server is running.");
  console.log(`- Parent dashboard: http://localhost:${PORT}/parent`);
  console.log(`- Health check: http://localhost:${PORT}/api/health`);
  console.log("============================================================");
  console.log("");
});
