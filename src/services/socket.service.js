import { Server } from "socket.io";
import { MessageModel } from "../models/chat.model.js";

let io;

// Store user socket connections: { userId: socketId }
const userSockets = new Map();

// ===== NOTIFICATION LOGGING =====
const logNotification = (type, userId, data, delivered) => {
    const timestamp = new Date().toISOString();
    const status = delivered ? "✅ DELIVERED" : "⏳ QUEUED (user offline)";
    
    console.log("\n" + "═".repeat(60));
    console.log(`📬 NOTIFICATION LOG - ${timestamp}`);
    console.log("═".repeat(60));
    console.log(`│ Type:      ${type}`);
    console.log(`│ To User:   ${userId}`);
    console.log(`│ Status:    ${status}`);
    console.log(`│ Data:      ${JSON.stringify(data, null, 2).split('\n').join('\n│            ')}`);
    console.log("═".repeat(60) + "\n");
};

export const initializeSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: ["http://localhost:5173", "https://skill-nexus-frontend.vercel.app"],
            methods: ["GET", "POST"],
            credentials: true,
        },
    });

    io.on("connection", (socket) => {
        console.log(`🔌 Socket connected: ${socket.id}`);

        // User joins with their userId
        socket.on("user:join", async (userId) => {
            if (userId) {
                // Always store userId as string for consistent lookup
                const userIdStr = userId.toString();
                userSockets.set(userIdStr, socket.id);
                socket.userId = userIdStr;
                console.log(`👤 User ${userIdStr} joined with socket ${socket.id}`);
                console.log(`📊 Active users: ${userSockets.size}`);
                console.log(`📊 User IDs in map: [${Array.from(userSockets.keys()).join(', ')}]`);

                // ===== CHECK FOR UNREAD MESSAGES =====
                try {
                    // Get unread message count
                    const unreadCount = await MessageModel.countDocuments({
                        receiver: userIdStr,
                        read: false,
                    });

                    if (unreadCount > 0) {
                        // Get details of who sent the messages
                        const unreadMessages = await MessageModel.aggregate([
                            { $match: { receiver: new (await import('mongoose')).default.Types.ObjectId(userIdStr), read: false } },
                            { $group: { _id: "$sender", count: { $sum: 1 }, lastMessage: { $last: "$message" }, tradeId: { $last: "$tradeId" } } },
                            { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "senderInfo" } },
                            { $unwind: "$senderInfo" },
                            { $project: { senderId: "$_id", senderName: "$senderInfo.name", count: 1, lastMessage: 1, tradeId: 1 } }
                        ]);

                        // Send notification to user about unread messages
                        socket.emit("unread:messages", {
                            totalCount: unreadCount,
                            conversations: unreadMessages.map(m => ({
                                senderId: m.senderId,
                                senderName: m.senderName,
                                count: m.count,
                                lastMessage: m.lastMessage,
                                tradeId: m.tradeId,
                            })),
                        });

                        console.log(`📨 Notified user ${userIdStr} about ${unreadCount} unread messages`);
                    }
                } catch (error) {
                    console.error("Error checking unread messages:", error);
                }
            }
        });

        // ===== CHAT EVENTS =====
        
        // Send message
        socket.on("chat:send", async (data) => {
            const { receiverId, message, tradeId } = data;
            const senderId = socket.userId;

            console.log("📨 Chat send request:", { senderId, receiverId, tradeId, message: message?.substring(0, 20) });
            console.log("📊 Active users in map:", Array.from(userSockets.keys()));

            if (!senderId || !receiverId || !message || !tradeId) {
                console.log("❌ Missing fields:", { senderId, receiverId, message: !!message, tradeId });
                socket.emit("chat:error", { message: "Missing required fields" });
                return;
            }

            try {
                // Save message to database
                const savedMessage = await MessageModel.create({
                    sender: senderId,
                    receiver: receiverId,
                    tradeId,
                    message: message.trim(),
                });

                const messageData = {
                    _id: savedMessage._id.toString(),
                    senderId: senderId.toString(),
                    receiverId: receiverId.toString(),
                    tradeId: tradeId.toString(),
                    message: savedMessage.message,
                    createdAt: savedMessage.createdAt,
                };

                // Try to find receiver with string conversion
                let receiverSocketId = getUserSocketId(receiverId);
                
                // If not found, try with string conversion
                if (!receiverSocketId) {
                    receiverSocketId = getUserSocketId(receiverId.toString());
                }
                
                console.log(`🔍 Looking for receiver ${receiverId}, found socket: ${receiverSocketId || 'NOT FOUND'}`);

                if (receiverSocketId) {
                    io.to(receiverSocketId).emit("chat:receive", messageData);
                    console.log(`✅ Message sent to receiver socket: ${receiverSocketId}`);
                } else {
                    console.log(`⚠️ Receiver ${receiverId} is offline or not found in socket map`);
                }

                // Confirm to sender
                socket.emit("chat:sent", messageData);

                console.log(`💬 Chat: ${senderId} → ${receiverId}: "${message.substring(0, 30)}..."`);
            } catch (error) {
                console.error("Chat error:", error);
                socket.emit("chat:error", { message: "Failed to send message" });
            }
        });

        // Typing indicator
        socket.on("chat:typing", ({ receiverId, tradeId }) => {
            const receiverSocketId = getUserSocketId(receiverId);
            if (receiverSocketId) {
                io.to(receiverSocketId).emit("chat:typing", {
                    senderId: socket.userId,
                    tradeId,
                });
            }
        });

        // Stop typing indicator
        socket.on("chat:stop-typing", ({ receiverId, tradeId }) => {
            const receiverSocketId = getUserSocketId(receiverId);
            if (receiverSocketId) {
                io.to(receiverSocketId).emit("chat:stop-typing", {
                    senderId: socket.userId,
                    tradeId,
                });
            }
        });

        // Handle disconnect
        socket.on("disconnect", () => {
            if (socket.userId) {
                userSockets.delete(socket.userId.toString());
                console.log(`👤 User ${socket.userId} disconnected`);
                console.log(`📊 Active users: ${userSockets.size}`);
                console.log(`📊 Remaining users: [${Array.from(userSockets.keys()).join(', ')}]`);
            }
            console.log(`🔌 Socket disconnected: ${socket.id}`);
        });
    });

    console.log("✅ Socket.IO initialized");
    return io;
};

export const getIO = () => {
    if (!io) {
        throw new Error("Socket.IO not initialized!");
    }
    return io;
};

// Get socket ID for a user
export const getUserSocketId = (userId) => {
    return userSockets.get(userId.toString());
};

// Send notification to a specific user with logging
export const sendNotificationToUser = (userId, event, data) => {
    const socketId = getUserSocketId(userId);
    const delivered = !!(socketId && io);
    
    // Log the notification
    logNotification(event, userId, data, delivered);
    
    if (delivered) {
        io.to(socketId).emit(event, data);
        return true;
    }
    return false;
};

// Notification Events
export const NOTIFICATION_EVENTS = {
    // Trade Request Events
    TRADE_REQUEST_RECEIVED: "notification:trade_request_received",
    TRADE_REQUEST_ACCEPTED: "notification:trade_request_accepted",
    TRADE_REQUEST_REJECTED: "notification:trade_request_rejected",
    TRADE_REQUEST_COMPLETED: "notification:trade_request_completed",
    TRADE_MARKED_COMPLETE: "notification:trade_marked_complete",
    // Review Events
    REVIEW_RECEIVED: "notification:review_received",
};

export default {
    initializeSocket,
    getIO,
    getUserSocketId,
    sendNotificationToUser,
    NOTIFICATION_EVENTS,
};

