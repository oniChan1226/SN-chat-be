import dotenv from "dotenv"
dotenv.config({
    path: "./.env",
});

import { createServer } from "http";
import connectDB from "./db/index.js";
import app from "./app.js"
import { initializeSocket } from "./services/socket.service.js";

const port = process.env.PORT || 8080;

; (async () => {
    try {
        await connectDB();
        
        // Create HTTP server and attach Socket.IO
        const server = createServer(app);
        initializeSocket(server);
        
        server.listen(port, () => console.log(`🚀 Server is running on port: ${port}`));
    } catch (error) {
        console.log("Error: ", error?.message);
    }
})();