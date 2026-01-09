import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    tradeRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TradeRequests",
      required: true,
    },
    reviewer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Users",
      required: true,
    },
    reviewee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Users",
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    review: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    skillReviewed: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Skills",
      required: true,
    },
  },
  { timestamps: true }
);

// Compound index to ensure one review per trade per reviewer-reviewee pair
reviewSchema.index({ tradeRequest: 1, reviewer: 1, reviewee: 1 }, { unique: true });

// Index for efficient queries
reviewSchema.index({ reviewee: 1, createdAt: -1 });
reviewSchema.index({ reviewer: 1, createdAt: -1 });

export const ReviewModel = mongoose.model("Reviews", reviewSchema);