import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
    {
        sender: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Users",
            required: true,
        },
        receiver: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Users",
            required: true,
        },
        tradeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "TradeRequest",
            required: true,
        },
        message: {
            type: String,
            required: true,
            trim: true,
        },
        read: {
            type: Boolean,
            default: false,
        },
    },
    { timestamps: true }
);

// Index for faster queries
messageSchema.index({ tradeId: 1, createdAt: 1 });
messageSchema.index({ sender: 1, receiver: 1 });

export const MessageModel = mongoose.model("Message", messageSchema);

