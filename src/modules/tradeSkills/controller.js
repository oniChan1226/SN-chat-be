import { TradeRequestModel } from "../../models/tradeRequest.model.js";
import { ReviewModel } from "../../models/review.model.js";
import { ApiResponse, ApiError, asyncHandler } from "../../utils/index.js";
import { sendNotificationToUser, NOTIFICATION_EVENTS } from "../../services/socket.service.js";
import mongoose from "mongoose";

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

/**
 * @desc Submit a review for a completed trade
 * @route POST /api/v1/trades/:tradeId/review
 */
export const submitReview = asyncHandler(async (req, res) => {
  const { tradeId } = req.params;
  const { rating, review, revieweeId } = req.body;
  const reviewerId = req.user._id;

  // Validate input
  if (!rating || !review || !revieweeId) {
    throw new ApiError(400, "Rating, review text, and reviewee ID are required");
  }

  if (rating < 1 || rating > 5) {
    throw new ApiError(400, "Rating must be between 1 and 5");
  }

  if (review.trim().length === 0 || review.length > 500) {
    throw new ApiError(400, "Review must be between 1 and 500 characters");
  }

  // Find the trade request
  const trade = await TradeRequestModel.findById(tradeId);
  if (!trade) {
    throw new ApiError(404, "Trade request not found");
  }

  // Check if trade is completed
  if (trade.status !== "completed") {
    throw new ApiError(400, "You can only review completed trades");
  }

  // Check if reviewer is part of this trade
  const isSender = trade.sender.toString() === reviewerId.toString();
  const isReceiver = trade.receiver.toString() === reviewerId.toString();

  if (!isSender && !isReceiver) {
    throw new ApiError(403, "You are not authorized to review this trade");
  }

  // Check if reviewee is the other party in the trade
  const isRevieweeValid = (isSender && trade.receiver.toString() === revieweeId) ||
                         (isReceiver && trade.sender.toString() === revieweeId);

  if (!isRevieweeValid) {
    throw new ApiError(400, "You can only review the other party in this trade");
  }

  // Determine which skill is being reviewed
  const skillReviewed = isSender ? trade.receiverOfferedSkill : trade.senderOfferedSkill;

  // Check if review already exists
  const existingReview = await ReviewModel.findOne({
    tradeRequest: tradeId,
    reviewer: reviewerId,
    reviewee: revieweeId
  });

  if (existingReview) {
    throw new ApiError(400, "You have already reviewed this trade");
  }

  // Create the review
  const newReview = await ReviewModel.create({
    tradeRequest: tradeId,
    reviewer: reviewerId,
    reviewee: revieweeId,
    rating,
    review: review.trim(),
    skillReviewed
  });

  // Populate the review for response
  const populatedReview = await ReviewModel.findById(newReview._id)
    .populate("reviewer", "name profileImage")
    .populate("reviewee", "name profileImage")
    .populate("skillReviewed", "name");

  // Update the reviewee's rating in their skill profile
  await updateUserRating(revieweeId);

  // 🔔 Send notification to reviewee
  sendNotificationToUser(revieweeId, NOTIFICATION_EVENTS.REVIEW_RECEIVED, {
    reviewId: newReview._id,
    reviewer: {
      name: populatedReview.reviewer.name,
      profileImage: populatedReview.reviewer.profileImage
    },
    rating,
    tradeId
  });

  return res
    .status(201)
    .json(new ApiResponse(201, populatedReview, "Review submitted successfully"));
});

/**
 * @desc Get all reviews for a user
 * @route GET /api/v1/trades/reviews/user/:userId
 */
export const getUserReviews = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { page = 1, limit = 10 } = req.query;

  const reviews = await ReviewModel.find({ reviewee: userId })
    .populate("reviewer", "name profileImage profession")
    .populate("skillReviewed", "name categories")
    .populate("tradeRequest", "senderOfferedSkill receiverOfferedSkill")
    .sort({ createdAt: -1 })
    .skip((parseInt(page) - 1) * parseInt(limit))
    .limit(parseInt(limit));

  const totalReviews = await ReviewModel.countDocuments({ reviewee: userId });

  // Calculate average rating
  const ratingStats = await ReviewModel.aggregate([
    { $match: { reviewee: userId } },
    {
      $group: {
        _id: null,
        averageRating: { $avg: "$rating" },
        totalReviews: { $sum: 1 },
        ratingDistribution: {
          $push: "$rating"
        }
      }
    }
  ]);

  const stats = ratingStats[0] || { averageRating: 0, totalReviews: 0, ratingDistribution: [] };

  // Calculate rating distribution
  const distribution = [1, 2, 3, 4, 5].map(rating => ({
    rating,
    count: stats.ratingDistribution.filter(r => r === rating).length
  }));

  return res.status(200).json(
    new ApiResponse(200, {
      reviews,
      stats: {
        averageRating: Math.round(stats.averageRating * 10) / 10,
        totalReviews: stats.totalReviews,
        ratingDistribution: distribution
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(totalReviews / parseInt(limit)),
        totalReviews
      }
    }, "User reviews retrieved successfully")
  );
});

/**
 * @desc Get reviews for a specific trade
 * @route GET /api/v1/trades/:tradeId/reviews
 */
export const getTradeReviews = asyncHandler(async (req, res) => {
  const { tradeId } = req.params;
  const userId = req.user._id;

  // Find the trade and check if user is part of it
  const trade = await TradeRequestModel.findById(tradeId);
  if (!trade) {
    throw new ApiError(404, "Trade request not found");
  }

  const isParticipant = trade.sender.toString() === userId.toString() ||
                       trade.receiver.toString() === userId.toString();

  if (!isParticipant) {
    throw new ApiError(403, "You are not authorized to view reviews for this trade");
  }

  const reviews = await ReviewModel.find({ tradeRequest: tradeId })
    .populate("reviewer", "name profileImage")
    .populate("reviewee", "name profileImage")
    .populate("skillReviewed", "name");

  return res
    .status(200)
    .json(new ApiResponse(200, reviews, "Trade reviews retrieved successfully"));
});

async function updateUserRating(userId) {
  try {
    const ratingStats = await ReviewModel.aggregate([
      { $match: { reviewee: userId } },
      {
        $group: {
          _id: null,
          averageRating: { $avg: "$rating" },
          totalReviews: { $sum: 1 }
        }
      }
    ]);

    const averageRating = ratingStats[0]?.averageRating || 0;

    // Import SkillProfileModel
    const { SkillProfileModel } = await import("../../models/skillProfile.model.js");

    // Update skill profile rating
    await SkillProfileModel.findOneAndUpdate(
      { userId },
      { rating: Math.round(averageRating * 10) / 10 },
      { upsert: false }
    );
  } catch (error) {
    console.error("Error updating user rating:", error);
  }
}
