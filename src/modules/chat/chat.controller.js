import { MessageModel } from "../../models/chat.model.js";
import { ApiResponse, asyncHandler, ApiError } from "../../utils/index.js";

// Get chat history for a trade
export const getChatHistory = asyncHandler(async (req, res) => {
    const { tradeId } = req.params;
    const userId = req.user._id;

    const messages = await MessageModel.find({ tradeId })
        .populate("sender", "name profileImage")
        .populate("receiver", "name profileImage")
        .sort({ createdAt: 1 }); // oldest first

    // Mark messages as read
    await MessageModel.updateMany(
        { tradeId, receiver: userId, read: false },
        { read: true }
    );

    return res.status(200).json(
        new ApiResponse(200, { messages }, "Chat history retrieved")
    );
});

// Get unread message count
export const getUnreadCount = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const count = await MessageModel.countDocuments({
        receiver: userId,
        read: false,
    });

    return res.status(200).json(
        new ApiResponse(200, { unreadCount: count }, "Unread count retrieved")
    );
});

