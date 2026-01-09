import { Router } from "express";
import { getChatHistory, getUnreadCount } from "./chat.controller.js";
import { verifyJwt } from "../../middlewares/auth.middleware.js";

const router = Router();

// Get chat history for a specific trade
router.get("/history/:tradeId", verifyJwt, getChatHistory);

// Get unread message count
router.get("/unread", verifyJwt, getUnreadCount);

export default router;

