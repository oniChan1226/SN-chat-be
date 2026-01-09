import { TradeRequestModel } from "../../models/tradeRequest.model.js";
import { ApiResponse, ApiError, asyncHandler } from "../../utils/index.js";
import { sendNotificationToUser, NOTIFICATION_EVENTS } from "../../services/socket.service.js";

/**
 * @desc Create a new barter (two-way) trade request
 * @route POST /api/v1/trades
 */
export const createTradeRequest = asyncHandler(async (req, res) => {
  const { receiverId, senderOfferedSkillId, receiverOfferedSkillId, message } =
    req.body;
  const senderId = req.user._id;

  if (!receiverId || !senderOfferedSkillId || !receiverOfferedSkillId) {
    throw new ApiError(400, "Missing required fields");
  }

  if (receiverId.toString() === senderId.toString()) {
    throw new ApiError(400, "You cannot trade with yourself");
  }

  // Prevent duplicate pending requests between same users
  const existing = await TradeRequestModel.findOne({
    sender: senderId,
    receiver: receiverId,
    senderOfferedSkill: senderOfferedSkillId,
    receiverOfferedSkill: receiverOfferedSkillId,
    status: "pending",
  });
  if (existing) throw new ApiError(400, "A pending trade already exists");

  const trade = await TradeRequestModel.create({
    sender: senderId,
    receiver: receiverId,
    senderOfferedSkill: senderOfferedSkillId,
    receiverOfferedSkill: receiverOfferedSkillId,
    message,
  });

  // Populate for notification
  const populatedTrade = await TradeRequestModel.findById(trade._id)
    .populate("sender", "name profileImage")
    .populate("senderOfferedSkill", "name")
    .populate("receiverOfferedSkill", "name");

  // 🔔 Send real-time notification to receiver
  sendNotificationToUser(receiverId, NOTIFICATION_EVENTS.TRADE_REQUEST_RECEIVED, {
    tradeId: trade._id,
    sender: {
      name: populatedTrade.sender.name,
      profileImage: populatedTrade.sender.profileImage,
    },
    senderOfferedSkill: populatedTrade.senderOfferedSkill.name,
    receiverOfferedSkill: populatedTrade.receiverOfferedSkill.name,
    message: trade.message,
    createdAt: trade.createdAt,
  });

  return res
    .status(201)
    .json(new ApiResponse(201, trade, "Trade request created successfully"));
});

/**
 * @desc Get all trades initiated by the logged-in user
 * @route GET /api/v1/trades/sent
 */
export const getSentTradeRequests = asyncHandler(async (req, res) => {
  const trades = await TradeRequestModel.find({ sender: req.user._id })
    .populate("receiver", "name profileImage")
    .populate("senderOfferedSkill", "name")
    .populate("receiverOfferedSkill", "name")
    .sort({ createdAt: -1 });

  return res
    .status(200)
    .json(new ApiResponse(200, {trades}, "Sent trades retrieved"));
});

/**
 * @desc Get all trades received by the logged-in user
 * @route GET /api/v1/trades/received
 */
export const getReceivedTradeRequests = asyncHandler(async (req, res) => {
  const trades = await TradeRequestModel.find({ receiver: req.user._id })
    .populate("sender", "name profileImage")
    .populate("senderOfferedSkill", "name")
    .populate("receiverOfferedSkill", "name")
    .sort({ createdAt: -1 });

  return res
    .status(200)
    .json(new ApiResponse(200, {trades}, "Received trades retrieved"));
});

/**
 * @desc Update trade status (accept/reject/complete)
 * @route PATCH /api/v1/trades/:id/status
 */
export const updateTradeStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const userId = req.user._id;

  const trade = await TradeRequestModel.findById(id)
    .populate("sender", "name profileImage")
    .populate("receiver", "name profileImage")
    .populate("senderOfferedSkill", "name")
    .populate("receiverOfferedSkill", "name");
    
  if (!trade) throw new ApiError(404, "Trade not found");

  const senderId = trade.sender._id.toString();
  const receiverId = trade.receiver._id.toString();

  if (![senderId, receiverId].includes(userId.toString())) {
    throw new ApiError(403, "Not authorized");
  }

  if (!["accepted", "rejected", "completed"].includes(status)) {
    throw new ApiError(400, "Invalid status");
  }

  // Determine who to notify (the other party)
  const notifyUserId = userId.toString() === senderId ? receiverId : senderId;
  const currentUser = userId.toString() === senderId ? trade.sender : trade.receiver;

  if (status === "accepted") {
    trade.status = status;
    
    // 🔔 Notify sender that their request was accepted
    sendNotificationToUser(senderId, NOTIFICATION_EVENTS.TRADE_REQUEST_ACCEPTED, {
      tradeId: trade._id,
      acceptedBy: {
        name: trade.receiver.name,
        profileImage: trade.receiver.profileImage,
      },
      senderOfferedSkill: trade.senderOfferedSkill.name,
      receiverOfferedSkill: trade.receiverOfferedSkill.name,
    });
  }

  if (status === "rejected") {
    trade.status = status;
    
    // 🔔 Notify sender that their request was rejected
    sendNotificationToUser(senderId, NOTIFICATION_EVENTS.TRADE_REQUEST_REJECTED, {
      tradeId: trade._id,
      rejectedBy: {
        name: trade.receiver.name,
        profileImage: trade.receiver.profileImage,
      },
      senderOfferedSkill: trade.senderOfferedSkill.name,
      receiverOfferedSkill: trade.receiverOfferedSkill.name,
    });
  }

  if (status === "completed") {
    if (!trade.completedBy.includes(userId)) {
      trade.completedBy.push(userId);
    }

    // Check if both parties marked as complete
    if (
      trade.completedBy.length === 2 &&
      trade.completedBy.some(id => id.toString() === senderId) &&
      trade.completedBy.some(id => id.toString() === receiverId)
    ) {
      trade.status = "completed";
      
      // 🔔 Notify both users that trade is fully completed
      sendNotificationToUser(senderId, NOTIFICATION_EVENTS.TRADE_REQUEST_COMPLETED, {
        tradeId: trade._id,
        partner: {
          name: trade.receiver.name,
          profileImage: trade.receiver.profileImage,
        },
        senderOfferedSkill: trade.senderOfferedSkill.name,
        receiverOfferedSkill: trade.receiverOfferedSkill.name,
      });
      
      sendNotificationToUser(receiverId, NOTIFICATION_EVENTS.TRADE_REQUEST_COMPLETED, {
        tradeId: trade._id,
        partner: {
          name: trade.sender.name,
          profileImage: trade.sender.profileImage,
        },
        senderOfferedSkill: trade.senderOfferedSkill.name,
        receiverOfferedSkill: trade.receiverOfferedSkill.name,
      });
    } else {
      // 🔔 Notify the other party that one person marked it complete
      sendNotificationToUser(notifyUserId, NOTIFICATION_EVENTS.TRADE_MARKED_COMPLETE, {
        tradeId: trade._id,
        markedBy: {
          name: currentUser.name,
          profileImage: currentUser.profileImage,
        },
        senderOfferedSkill: trade.senderOfferedSkill.name,
        receiverOfferedSkill: trade.receiverOfferedSkill.name,
      });
    }
  }

  await trade.save();

  return res
    .status(200)
    .json(new ApiResponse(200, trade, "Trade updated successfully"));
});
