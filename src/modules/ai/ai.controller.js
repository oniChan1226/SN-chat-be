import { asyncHandler, ApiResponse, ApiError } from "../../utils/index.js";
import { SkillProfileModel } from "../../models/skillProfile.model.js";
import { SkillModel } from "../../models/skill.model.js";
import { User } from "../../models/user.model.js";
import AIService from "../../services/ai.service.js";
import CustomAIService from "../../services/customAI.service.js";

// Initialize custom AI service
const customAI = new CustomAIService();

/**
 * Get AI-powered skill match between current user and a specific user
 * POST /api/v1/ai/match-score/:userId
 */
export const getSkillMatchScore = asyncHandler(async (req, res) => {
    const { user } = req;
    const { userId } = req.params;

    // Get current user's skill profile
    const currentUserProfile = await SkillProfileModel.findOne({ userId: user._id })
        .populate("offeredSkills")
        .populate("requiredSkills");

    if (!currentUserProfile) {
        throw new ApiError(404, "Your skill profile not found");
    }

    // Get other user's skill profile
    const otherUserProfile = await SkillProfileModel.findOne({ userId })
        .populate("offeredSkills")
        .populate("requiredSkills")
        .populate("userId");

    if (!otherUserProfile) {
        throw new ApiError(404, "User skill profile not found");
    }

    // Calculate bidirectional match
    const matchResult = await AIService.calculateBidirectionalMatch(
        {
            offered: currentUserProfile.offeredSkills,
            required: currentUserProfile.requiredSkills
        },
        {
            offered: otherUserProfile.offeredSkills,
            required: otherUserProfile.requiredSkills
        }
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                user: {
                    id: otherUserProfile.userId._id,
                    name: otherUserProfile.userId.name,
                    profession: otherUserProfile.userId.profession
                },
                match: matchResult
            },
            "Skill match calculated successfully"
        )
    );
});

/**
 * Get AI-powered recommendations for users to connect with
 * GET /api/v1/ai/recommended-users
 */
export const getRecommendedUsers = asyncHandler(async (req, res) => {
    const { user } = req;
    const { limit = 10 } = req.query;

    // Get current user's profile and skills
    const currentUserProfile = await SkillProfileModel.findOne({ userId: user._id })
        .populate("offeredSkills")
        .populate("requiredSkills");

    if (!currentUserProfile) {
        throw new ApiError(404, "Your skill profile not found");
    }

    // Get all other users with their profiles
    const otherUsers = await SkillProfileModel.find({
        userId: { $ne: user._id }
    })
        .populate("offeredSkills")
        .populate("requiredSkills")
        .populate("userId")
        .limit(50); // Get top 50 to rank

    if (otherUsers.length === 0) {
        return res.status(200).json(
            new ApiResponse(200, { users: [] }, "No users found")
        );
    }

    // Rank users using AI
    const rankedUsers = [];

    for (const otherUser of otherUsers) {
        const skillMatch = await AIService.calculateBidirectionalMatch(
            {
                offered: currentUserProfile.offeredSkills,
                required: currentUserProfile.requiredSkills
            },
            {
                offered: otherUser.offeredSkills,
                required: otherUser.requiredSkills
            }
        );

        const score = await AIService.calculateUserScore(
            {
                offeredSkills: currentUserProfile.offeredSkills,
                requiredSkills: currentUserProfile.requiredSkills,
                address: user.address
            },
            {
                offeredSkills: otherUser.offeredSkills,
                requiredSkills: otherUser.requiredSkills,
                rating: otherUser.rating,
                totalExchanges: otherUser.totalExchanges,
                metrics: otherUser.metrics,
                user: otherUser.userId
            }
        );

        rankedUsers.push({
            user: {
                id: otherUser.userId._id,
                name: otherUser.userId.name,
                email: otherUser.userId.email,
                profession: otherUser.userId.profession,
                profileImage: otherUser.userId.profileImage,
                bio: otherUser.userId.bio,
                address: otherUser.userId.address,
                socialLinks: otherUser.userId.socialLinks
            },
            skillProfile: {
                rating: otherUser.rating,
                totalExchanges: otherUser.totalExchanges,
                offeredSkills: otherUser.offeredSkills,
                requiredSkills: otherUser.requiredSkills
            },
            aiScore: score,
            matchPercentage: skillMatch.matchPercentage,
            canTeach: skillMatch.canTeach,
            canLearn: skillMatch.canLearn,
            isMutualMatch: skillMatch.isMutualMatch,
            recommendation: AIService.getRecommendationText(score)
        });
    }

    // Sort by AI score and limit
    rankedUsers.sort((a, b) => b.aiScore - a.aiScore);
    const topUsers = rankedUsers.slice(0, parseInt(limit));

    return res.status(200).json(
        new ApiResponse(
            200,
            { users: topUsers },
            "AI-recommended users retrieved successfully"
        )
    );
});

/**
 * Get AI-powered skill recommendations for learning
 * GET /api/v1/ai/skill-recommendations
 */
export const getSkillRecommendations = asyncHandler(async (req, res) => {
    const { user } = req;

    // Get user's profile and skills
    const userProfile = await SkillProfileModel.findOne({ userId: user._id })
        .populate("offeredSkills")
        .populate("requiredSkills");

    if (!userProfile) {
        throw new ApiError(404, "Skill profile not found");
    }

    // Get user details
    const userDetails = await User.findById(user._id);

    // Generate AI recommendations
    const recommendations = await AIService.generateSkillRecommendations(
        {
            profession: userDetails.profession,
            bio: userDetails.bio
        },
        {
            offered: userProfile.offeredSkills,
            required: userProfile.requiredSkills
        }
    );

    // Generate learning path
    const learningPath = AIService.generateLearningPath(
        userProfile.offeredSkills,
        userProfile.requiredSkills
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                recommendations,
                learningPath,
                currentSkills: {
                    offered: userProfile.offeredSkills.length,
                    required: userProfile.requiredSkills.length
                }
            },
            "Skill recommendations generated successfully"
        )
    );
});

/**
 * Analyze user profile with AI insights
 * GET /api/v1/ai/profile-analysis
 */
export const analyzeProfile = asyncHandler(async (req, res) => {
    const { user } = req;

    // Get user profile
    const userProfile = await SkillProfileModel.findOne({ userId: user._id })
        .populate("offeredSkills")
        .populate("requiredSkills");

    if (!userProfile) {
        throw new ApiError(404, "Skill profile not found");
    }

    // Analyze profile sentiment
    const analysis = await AIService.analyzeProfile({
        bio: user.bio,
        profileImage: user.profileImage,
        socialLinks: user.socialLinks
    });

    // Calculate profile completeness
    const completeness = {
        bio: user.bio ? 15 : 0,
        profileImage: user.profileImage ? 15 : 0,
        address: user.address?.city && user.address?.country ? 10 : 0,
        profession: user.profession ? 10 : 0,
        socialLinks: Object.values(user.socialLinks || {}).filter(link => link).length * 5,
        offeredSkills: Math.min(userProfile.offeredSkills.length * 5, 25),
        requiredSkills: Math.min(userProfile.requiredSkills.length * 5, 20)
    };

    const totalCompleteness = Object.values(completeness).reduce((sum, val) => sum + val, 0);

    // Generate suggestions
    const suggestions = [];
    if (completeness.bio === 0) suggestions.push("Add a bio to tell others about yourself");
    if (completeness.profileImage === 0) suggestions.push("Upload a profile picture");
    if (completeness.address === 0) suggestions.push("Add your location to find local skill traders");
    if (completeness.profession === 0) suggestions.push("Specify your profession");
    if (completeness.socialLinks < 10) suggestions.push("Add more social links (GitHub, LinkedIn, etc.)");
    if (completeness.offeredSkills < 15) suggestions.push("Add more skills you can teach");
    if (completeness.requiredSkills < 10) suggestions.push("Add more skills you want to learn");

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                profileStrength: totalCompleteness,
                completeness,
                sentiment: analysis,
                suggestions,
                stats: {
                    rating: userProfile.rating,
                    totalExchanges: userProfile.totalExchanges,
                    offeredSkills: userProfile.offeredSkills.length,
                    requiredSkills: userProfile.requiredSkills.length
                }
            },
            "Profile analysis completed"
        )
    );
});

/**
 * Find best matches for a specific skill
 * GET /api/v1/ai/find-teachers/:skillName
 */
export const findTeachersForSkill = asyncHandler(async (req, res) => {
    const { skillName } = req.params;
    const { limit = 10 } = req.query;

    // Find all users who offer this skill
    const skills = await SkillModel.find({
        name: { $regex: skillName, $options: "i" }
    });

    if (skills.length === 0) {
        return res.status(200).json(
            new ApiResponse(200, { teachers: [] }, "No teachers found for this skill")
        );
    }

    const skillIds = skills.map(s => s._id);

    // Find skill profiles with these skills
    const profiles = await SkillProfileModel.find({
        offeredSkills: { $in: skillIds }
    })
        .populate("offeredSkills")
        .populate("requiredSkills")
        .populate("userId");

    // Rank by proficiency and rating
    const rankedTeachers = profiles
        .map(profile => {
            const matchingSkill = profile.offeredSkills.find(
                s => skillIds.some(id => id.equals(s._id))
            );

            const proficiencyScore = {
                expert: 3,
                intermediate: 2,
                beginner: 1
            }[matchingSkill.proficiencyLevel] || 0;

            const score = (proficiencyScore * 30) + (profile.rating * 14) + (Math.min(profile.totalExchanges, 10) * 2);

            return {
                user: {
                    id: profile.userId._id,
                    name: profile.userId.name,
                    profession: profile.userId.profession,
                    profileImage: profile.userId.profileImage,
                    bio: profile.userId.bio,
                    address: profile.userId.address
                },
                skill: {
                    name: matchingSkill.name,
                    proficiencyLevel: matchingSkill.proficiencyLevel,
                    description: matchingSkill.description
                },
                rating: profile.rating,
                totalExchanges: profile.totalExchanges,
                teacherScore: score
            };
        })
        .sort((a, b) => b.teacherScore - a.teacherScore)
        .slice(0, parseInt(limit));

    return res.status(200).json(
        new ApiResponse(
            200,
            { teachers: rankedTeachers },
            "Teachers found successfully"
        )
    );
});

/**
 * Get mutual skill matches (skills both users can teach each other)
 * GET /api/v1/ai/mutual-matches
 */
export const getMutualMatches = asyncHandler(async (req, res) => {
    const { user } = req;
    const { limit = 20 } = req.query;

    // Get current user's profile
    const currentUserProfile = await SkillProfileModel.findOne({ userId: user._id })
        .populate("offeredSkills")
        .populate("requiredSkills");

    if (!currentUserProfile) {
        throw new ApiError(404, "Your skill profile not found");
    }

    // Find users where there's mutual benefit
    const allProfiles = await SkillProfileModel.find({
        userId: { $ne: user._id }
    })
        .populate("offeredSkills")
        .populate("requiredSkills")
        .populate("userId");

    const mutualMatches = [];

    for (const profile of allProfiles) {
        const match = await AIService.calculateBidirectionalMatch(
            {
                offered: currentUserProfile.offeredSkills,
                required: currentUserProfile.requiredSkills
            },
            {
                offered: profile.offeredSkills,
                required: profile.requiredSkills
            }
        );

        if (match.isMutualMatch && match.overallScore > 0.5) {
            mutualMatches.push({
                user: {
                    id: profile.userId._id,
                    name: profile.userId.name,
                    profession: profile.userId.profession,
                    profileImage: profile.userId.profileImage,
                    address: profile.userId.address
                },
                match,
                rating: profile.rating,
                totalExchanges: profile.totalExchanges
            });
        }
    }

    // Sort by match score
    mutualMatches.sort((a, b) => b.match.overallScore - a.match.overallScore);
    const topMatches = mutualMatches.slice(0, parseInt(limit));

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                matches: topMatches,
                totalMutualMatches: mutualMatches.length
            },
            "Mutual matches found successfully"
        )
    );
});

/**
 * Get top 3 AI-powered bi-directional skill matches
 * GET /api/v1/ai/top-matches
 */
export const getTopMatches = asyncHandler(async (req, res) => {
    const { user } = req;

    // Get current user's profile
    const currentUserProfile = await SkillProfileModel.findOne({ userId: user._id })
        .populate("offeredSkills")
        .populate("requiredSkills");

    if (!currentUserProfile) {
        throw new ApiError(404, "Your skill profile not found");
    }

    // Find all other user profiles
    const allProfiles = await SkillProfileModel.find({
        userId: { $ne: user._id }
    })
        .populate("offeredSkills")
        .populate("requiredSkills")
        .populate("userId", "name profession profileImage address bio rating totalExchanges metrics");

    const matches = [];

    for (const profile of allProfiles) {
        const match = await AIService.calculateBidirectionalMatch(
            {
                offered: currentUserProfile.offeredSkills,
                required: currentUserProfile.requiredSkills
            },
            {
                offered: profile.offeredSkills,
                required: profile.requiredSkills
            }
        );

        // Include all matches with any score > 0, not just mutual ones
        if (match.overallScore > 0) {
            matches.push({
                user: {
                    id: profile.userId._id,
                    name: profile.userId.name,
                    profession: profile.userId.profession,
                    profileImage: profile.userId.profileImage,
                    address: profile.userId.address,
                    bio: profile.userId.bio
                },
                match: {
                    ...match,
                    // Add individual direction scores
                    offeredToRequiredScore: match.canTeach.length > 0 ? 
                        match.canTeach.reduce((sum, m) => sum + m.matchScore, 0) / match.canTeach.length : 0,
                    requiredToOfferedScore: match.canLearn.length > 0 ? 
                        match.canLearn.reduce((sum, m) => sum + m.matchScore, 0) / match.canLearn.length : 0
                },
                stats: {
                    rating: profile.rating,
                    totalExchanges: profile.totalExchanges,
                    pendingRequests: profile.metrics.pendingRequests,
                    acceptedRequests: profile.metrics.acceptedRequests,
                    completedRequests: profile.metrics.completedRequests,
                    successRate: profile.metrics.acceptedRequests > 0 ? 
                        (profile.metrics.completedRequests / profile.metrics.acceptedRequests * 100).toFixed(1) : 0
                }
            });
        }
    }

    // Sort by overall match score (descending)
    matches.sort((a, b) => b.match.overallScore - a.match.overallScore);
    
    // Return top 3 matches
    const topMatches = matches.slice(0, 3);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                matches: topMatches,
                totalPotentialMatches: matches.length
            },
            "Top skill matches found successfully"
        )
    );
});

/**
 * Get top 3 most required skills across all users in the application
 * GET /api/v1/ai/analytics/top-required-skills
 */
export const getTopRequiredSkills = asyncHandler(async (req, res) => {
    // Aggregate all required skills and count their frequency
    const skillStats = await SkillProfileModel.aggregate([
        {
            $unwind: "$requiredSkills"
        },
        {
            $group: {
                _id: "$requiredSkills",
                count: { $sum: 1 }
            }
        },
        {
            $lookup: {
                from: "skills",
                localField: "_id",
                foreignField: "_id",
                as: "skillDetails"
            }
        },
        {
            $unwind: "$skillDetails"
        },
        {
            $project: {
                skillId: "$_id",
                name: "$skillDetails.name",
                proficiencyLevel: "$skillDetails.proficiencyLevel",
                learningPriority: "$skillDetails.learningPriority",
                categories: "$skillDetails.categories",
                description: "$skillDetails.description",
                count: 1,
                totalRequests: "$skillDetails.metrics.totalRequests",
                acceptedRequests: "$skillDetails.metrics.acceptedRequests",
                completedRequests: "$skillDetails.metrics.completedRequests"
            }
        },
        {
            $sort: { count: -1 }
        },
        {
            $limit: 3
        }
    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                topRequiredSkills: skillStats,
                totalSkillsAnalyzed: skillStats.length
            },
            "Top required skills retrieved successfully"
        )
    );
});

/**
 * Get top 3 most offered skills across all users in the application
 * GET /api/v1/ai/analytics/top-offered-skills
 */
export const getTopOfferedSkills = asyncHandler(async (req, res) => {
    // Aggregate all offered skills and count their frequency
    const skillStats = await SkillProfileModel.aggregate([
        {
            $unwind: "$offeredSkills"
        },
        {
            $group: {
                _id: "$offeredSkills",
                count: { $sum: 1 }
            }
        },
        {
            $lookup: {
                from: "skills",
                localField: "_id",
                foreignField: "_id",
                as: "skillDetails"
            }
        },
        {
            $unwind: "$skillDetails"
        },
        {
            $project: {
                skillId: "$_id",
                name: "$skillDetails.name",
                proficiencyLevel: "$skillDetails.proficiencyLevel",
                learningPriority: "$skillDetails.learningPriority",
                categories: "$skillDetails.categories",
                description: "$skillDetails.description",
                count: 1,
                totalRequests: "$skillDetails.metrics.totalRequests",
                acceptedRequests: "$skillDetails.metrics.acceptedRequests",
                completedRequests: "$skillDetails.metrics.completedRequests"
            }
        },
        {
            $sort: { count: -1 }
        },
        {
            $limit: 3
        }
    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                topOfferedSkills: skillStats,
                totalSkillsAnalyzed: skillStats.length
            },
            "Top offered skills retrieved successfully"
        )
    );
});

/**
 * Get comprehensive analytics for a specific user
 * GET /api/v1/ai/analytics/user/:userId
 */
export const getUserAnalytics = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { user } = req;

    // Check if requesting own analytics or if admin (for now, allow own analytics only)
    if (userId !== user._id.toString()) {
        throw new ApiError(403, "You can only view your own analytics");
    }

    // Get user's skill profile with populated skills
    const skillProfile = await SkillProfileModel.findOne({ userId })
        .populate("offeredSkills")
        .populate("requiredSkills");

    if (!skillProfile) {
        throw new ApiError(404, "Skill profile not found");
    }

    // Get user's basic info
    const userInfo = await User.findById(userId).select("name profession address bio");

    // Calculate additional analytics
    const totalOfferedSkills = skillProfile.offeredSkills.length;
    const totalRequiredSkills = skillProfile.requiredSkills.length;

    const analytics = {
        user: {
            id: userInfo._id,
            name: userInfo.name,
            profession: userInfo.profession,
            address: userInfo.address,
            bio: userInfo.bio
        },
        skills: {
            offered: {
                count: totalOfferedSkills,
                skills: skillProfile.offeredSkills.map(skill => ({
                    id: skill._id,
                    name: skill.name,
                    proficiencyLevel: skill.proficiencyLevel,
                    categories: skill.categories
                }))
            },
            required: {
                count: totalRequiredSkills,
                skills: skillProfile.requiredSkills.map(skill => ({
                    id: skill._id,
                    name: skill.name,
                    learningPriority: skill.learningPriority,
                    categories: skill.categories
                }))
            }
        },
        tradingMetrics: {
            rating: skillProfile.rating,
            totalExchanges: skillProfile.totalExchanges,
            pendingRequests: skillProfile.metrics.pendingRequests,
            acceptedRequests: skillProfile.metrics.acceptedRequests,
            completedRequests: skillProfile.metrics.completedRequests,
            rejectedRequests: skillProfile.metrics.rejectedRequests,
            successRate: skillProfile.metrics.acceptedRequests > 0 ?
                ((skillProfile.metrics.completedRequests / skillProfile.metrics.acceptedRequests) * 100).toFixed(1) : 0,
            responseRate: (skillProfile.metrics.acceptedRequests + skillProfile.metrics.rejectedRequests) > 0 ?
                (((skillProfile.metrics.acceptedRequests + skillProfile.metrics.rejectedRequests) / (skillProfile.metrics.acceptedRequests + skillProfile.metrics.rejectedRequests + skillProfile.metrics.pendingRequests)) * 100).toFixed(1) : 0
        },
        activitySummary: {
            totalSkillsListed: totalOfferedSkills + totalRequiredSkills,
            activeRequests: skillProfile.metrics.pendingRequests,
            completedTrades: skillProfile.metrics.completedRequests,
            averageRating: skillProfile.rating.toFixed(1)
        }
    };

    return res.status(200).json(
        new ApiResponse(
            200,
            analytics,
            "User analytics retrieved successfully"
        )
    );
});

/**
 * Custom AI: Calculate skill similarity using neural network
 * POST /api/v1/ai/custom/skill-similarity
 */
export const getCustomSkillSimilarity = asyncHandler(async (req, res) => {
    const { skill1, skill2 } = req.body;

    if (!skill1 || !skill2) {
        throw new ApiError(400, "Both skill1 and skill2 are required");
    }

    const similarity = customAI.calculateSkillSimilarity(skill1, skill2);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                skill1,
                skill2,
                similarityScore: similarity,
                interpretation: similarity > 0.7 ? "Highly Similar" :
                    similarity > 0.4 ? "Moderately Similar" : "Different",
                method: "Custom Neural Network (2-Layer Feed-Forward)"
            },
            "Skill similarity calculated using custom AI"
        )
    );
});

/**
 * Custom AI: Get learning path prediction
 * POST /api/v1/ai/custom/learning-path
 */
export const getCustomLearningPath = asyncHandler(async (req, res) => {
    const { user } = req;
    const { targetSkill } = req.body;

    if (!targetSkill) {
        throw new ApiError(400, "Target skill is required");
    }

    // Get user's current skills with proficiency levels
    const userProfile = await SkillProfileModel.findOne({ userId: user._id })
        .populate("offeredSkills");

    if (!userProfile) {
        throw new ApiError(404, "Skill profile not found");
    }

    const currentSkills = userProfile.offeredSkills.map(s => ({
        name: s.name,
        proficiency: s.proficiencyLevel || 'beginner'
    }));

    // Generate target skill embedding
    const targetEmbedding = customAI.generateEmbedding(targetSkill);
    
    // Find prerequisite skills based on target skill analysis
    const prerequisites = customAI.analyzePrerequisites(targetSkill);
    
    // Calculate skill gaps using similarity scoring
    const currentSkillNames = currentSkills.map(s => s.name);
    const missingPrerequisites = [];
    const existingPrerequisites = [];
    
    // Check each prerequisite against user's current skills
    prerequisites.forEach(prereq => {
        let isExisting = false;
        let maxSimilarity = 0;
        let matchedSkill = null;
        
        // Check if user already has this skill or something similar
        for (const userSkill of currentSkillNames) {
            const similarity = customAI.calculateSkillSimilarity(
                userSkill.toLowerCase(), 
                prereq.skill.toLowerCase()
            );
            
            if (similarity > maxSimilarity) {
                maxSimilarity = similarity;
                matchedSkill = userSkill;
            }
            
            // Lower threshold to 0.4 for better matching (was 0.5)
            // Also handle broad skills like "Web Development" matching specific skills
            const userSkillLower = userSkill.toLowerCase();
            const prereqLower = prereq.skill.toLowerCase();
            
            // Direct similarity check
            if (similarity > 0.4) {
                isExisting = true;
                break;
            }
            
            // Special handling for broad skills
            if (userSkillLower.includes('web development') || userSkillLower.includes('full stack')) {
                // Web Development should cover HTML, CSS, JavaScript, Frontend basics
                if (prereqLower.includes('html') || 
                    prereqLower.includes('css') || 
                    prereqLower.includes('javascript') ||
                    prereqLower.includes('frontend')) {
                    isExisting = true;
                    break;
                }
            }
            
            if (userSkillLower.includes('frontend') || userSkillLower.includes('front-end')) {
                if (prereqLower.includes('html') || 
                    prereqLower.includes('css') || 
                    prereqLower.includes('javascript') ||
                    prereqLower.includes('react') ||
                    prereqLower.includes('vue') ||
                    prereqLower.includes('ui')) {
                    isExisting = true;
                    break;
                }
            }
            
            if (userSkillLower.includes('backend') || userSkillLower.includes('back-end')) {
                if (prereqLower.includes('node') || 
                    prereqLower.includes('database') || 
                    prereqLower.includes('api') ||
                    prereqLower.includes('server')) {
                    isExisting = true;
                    break;
                }
            }
        }
        
        if (isExisting) {
            existingPrerequisites.push({ 
                ...prereq, 
                matchedSimilarity: maxSimilarity,
                matchedWith: matchedSkill 
            });
        } else {
            missingPrerequisites.push(prereq);
        }
    });

    // Calculate readiness score (higher weight on target-specific prerequisites)
    const readinessScore = Math.min(
        100,
        (existingPrerequisites.length / Math.max(prerequisites.length, 1)) * 100
    );

    // Generate progressive learning steps
    const learningSteps = [];
    
    // Phase 1: Foundation skills (if needed)
    if (missingPrerequisites.some(p => p.phase === 'foundation')) {
        learningSteps.push({
            phase: 1,
            title: "Foundation Skills",
            description: `Build fundamental knowledge required for ${targetSkill}`,
            duration: "2-4 weeks",
            skills: missingPrerequisites
                .filter(p => p.phase === 'foundation')
                .map(p => ({
                    skill: p.skill,
                    reason: p.reason,
                    priority: "HIGH",
                    estimatedTime: p.estimatedTime,
                    similarityToTarget: customAI.calculateSkillSimilarity(p.skill, targetSkill)
                }))
                .sort((a, b) => b.similarityToTarget - a.similarityToTarget)
        });
    }

    // Phase 2: Core prerequisites
    if (missingPrerequisites.some(p => p.phase === 'core')) {
        learningSteps.push({
            phase: 2,
            title: "Core Prerequisites",
            description: `Essential skills directly related to ${targetSkill}`,
            duration: "4-6 weeks",
            skills: missingPrerequisites
                .filter(p => p.phase === 'core')
                .map(p => ({
                    skill: p.skill,
                    reason: p.reason,
                    priority: "CRITICAL",
                    estimatedTime: p.estimatedTime,
                    similarityToTarget: customAI.calculateSkillSimilarity(p.skill, targetSkill)
                }))
                .sort((a, b) => b.similarityToTarget - a.similarityToTarget)
        });
    }

    // Phase 3: Advanced/Specialized skills
    if (missingPrerequisites.some(p => p.phase === 'advanced')) {
        learningSteps.push({
            phase: 3,
            title: "Advanced Concepts",
            description: `Specialized knowledge for mastering ${targetSkill}`,
            duration: "3-5 weeks",
            skills: missingPrerequisites
                .filter(p => p.phase === 'advanced')
                .map(p => ({
                    skill: p.skill,
                    reason: p.reason,
                    priority: "MEDIUM",
                    estimatedTime: p.estimatedTime,
                    similarityToTarget: customAI.calculateSkillSimilarity(p.skill, targetSkill)
                }))
                .sort((a, b) => b.similarityToTarget - a.similarityToTarget)
        });
    }

    // Phase 4: Target skill mastery
    learningSteps.push({
        phase: learningSteps.length + 1,
        title: `Master ${targetSkill}`,
        description: "Hands-on practice and real-world application",
        duration: "6-8 weeks",
        skills: [{
            skill: targetSkill,
            reason: "Your target skill - focus on practical projects and real-world scenarios",
            priority: "TARGET",
            estimatedTime: "Ongoing",
            similarityToTarget: 1.0
        }]
    });

    // Calculate total estimated time
    const totalWeeks = learningSteps.reduce((sum, step) => {
        const weeks = parseInt(step.duration.split('-')[0]) || 0;
        return sum + weeks;
    }, 0);

    // Generate personalized recommendations
    const recommendations = {
        startWith: learningSteps[0]?.skills[0]?.skill || targetSkill,
        focusAreas: missingPrerequisites
            .filter(p => p.phase === 'core')
            .map(p => p.skill)
            .slice(0, 3),
        leverageExisting: [
            ...currentSkills
                .filter(s => {
                    const similarity = customAI.calculateSkillSimilarity(s.name, targetSkill);
                    return similarity > 0.25; // Lower threshold to show more relevant skills
                })
                .map(s => s.name)
                .slice(0, 5),
            // Also include skills that matched prerequisites
            ...existingPrerequisites
                .map(p => p.matchedWith)
                .filter((v, i, a) => v && a.indexOf(v) === i) // Remove duplicates
        ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 5), // Final deduplication
        studyApproach: readinessScore > 70 
            ? "You have a strong foundation! Focus on specialized aspects and practical projects."
            : readinessScore > 40
            ? "Build core prerequisites first, then move to hands-on practice."
            : readinessScore > 20
            ? "You have some foundational knowledge. Focus on filling gaps and building core skills."
            : "Start with fundamentals and gradually progress to more advanced topics.",
        estimatedTimeToTarget: `${totalWeeks}-${totalWeeks + 4} weeks with consistent practice`
    };

    // Find potential mentors/teachers
    const potentialMentors = await SkillProfileModel.find({
        userId: { $ne: user._id },
        offeredSkills: { 
            $elemMatch: { 
                name: { $regex: new RegExp(targetSkill, 'i') },
                proficiencyLevel: { $in: ['intermediate', 'expert'] }
            }
        }
    })
        .populate('offeredSkills')
        .populate('userId', 'name profession profileImage')
        .limit(5);

    const mentors = potentialMentors.map(profile => ({
        id: profile.userId._id,
        name: profile.userId.name,
        profession: profile.userId.profession,
        profileImage: profile.userId.profileImage,
        skillLevel: profile.offeredSkills.find(s => 
            s.name.toLowerCase().includes(targetSkill.toLowerCase())
        )?.proficiencyLevel || 'intermediate',
        rating: profile.rating
    }));

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                targetSkill,
                readinessScore: Math.round(readinessScore),
                readinessLevel: readinessScore > 70 ? "Ready" : readinessScore > 40 ? "Moderate" : "Beginner",
                currentSkillsCount: currentSkills.length,
                learningPath: learningSteps,
                recommendations,
                mentorsAvailable: mentors,
                gapAnalysis: {
                    totalPrerequisites: prerequisites.length,
                    skillsYouHave: existingPrerequisites.length,
                    skillsToLearn: missingPrerequisites.length,
                    estimatedTotalTime: recommendations.estimatedTimeToTarget
                }
            },
            "Personalized learning path generated successfully"
        )
    );
});

/**
 * Custom AI: Advanced user matching with neural network
 * GET /api/v1/ai/custom/advanced-matches
 */
export const getCustomAdvancedMatches = asyncHandler(async (req, res) => {
    const { user } = req;
    const { limit = 10 } = req.query;

    // Get current user's profile
    const currentUserProfile = await SkillProfileModel.findOne({ userId: user._id })
        .populate("offeredSkills")
        .populate("requiredSkills");

    if (!currentUserProfile) {
        throw new ApiError(404, "Your skill profile not found");
    }

    // Get all other users
    const otherProfiles = await SkillProfileModel.find({
        userId: { $ne: user._id }
    })
        .populate("offeredSkills")
        .populate("requiredSkills")
        .populate("userId");

    // Calculate custom AI similarity for each user
    const matches = [];
    for (const profile of otherProfiles) {
        const currentOffered = currentUserProfile?.offeredSkills?.map(s => s.name);
        const currentRequired = currentUserProfile?.requiredSkills?.map(s => s.name);
        const otherOffered = profile?.offeredSkills?.map(s => s.name);
        const otherRequired = profile?.requiredSkills?.map(s => s.name);

        // Forward match: My required vs their offered
        const forwardScore = customAI.calculateUserSimilarity(
            currentRequired,
            otherOffered
        );

        // Backward match: Their required vs my offered
        const backwardScore = customAI.calculateUserSimilarity(
            otherRequired,
            currentOffered
        );

        // Overall score
        const overallScore = (forwardScore + backwardScore) / 2;

        if (overallScore > 0.3) { // Threshold
            matches.push({
                user: {
                    id: profile.userId._id,
                    name: profile.userId.name,
                    profession: profile.userId.profession,
                    profileImage: profile.userId.profileImage
                },
                matchScore: {
                    overall: overallScore,
                    canTeachYou: forwardScore,
                    canLearnFrom: backwardScore
                },
                method: "Custom Neural Network",
                offeredSkills: otherOffered.slice(0, 5),
                requiredSkills: otherRequired.slice(0, 5)
            });
        }
    }

    // Sort by overall score
    matches.sort((a, b) => b.matchScore.overall - a.matchScore.overall);
    const topMatches = matches.slice(0, parseInt(limit));

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                matches: topMatches,
                totalMatches: matches.length,
                algorithm: "Custom 2-Layer Neural Network with TF-IDF Embeddings"
            },
            "Advanced matches calculated using custom AI"
        )
    );
});

/**
 * Custom AI: Estimate proficiency for a skill
 * POST /api/v1/ai/custom/estimate-proficiency
 */
export const getCustomProficiencyEstimate = asyncHandler(async (req, res) => {
    const { user } = req;
    const { skillName } = req.body;

    if (!skillName) {
        throw new ApiError(400, "Skill name is required");
    }

    // Get user's current skills with proficiency
    const userProfile = await SkillProfileModel.findOne({ userId: user._id })
        .populate("offeredSkills");

    if (!userProfile) {
        throw new ApiError(404, "Skill profile not found");
    }

    const relatedSkills = userProfile?.offeredSkills?.map(s => s.name);
    const userRatings = userProfile?.offeredSkills?.map(s => s.proficiencyLevel || 3);

    const estimatedProficiency = customAI.estimateProficiency(
        skillName,
        relatedSkills,
        userRatings
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                skillName,
                estimatedProficiency: Math.round(estimatedProficiency * 10) / 10,
                proficiencyLevel: estimatedProficiency >= 4 ? "Advanced" :
                    estimatedProficiency >= 3 ? "Intermediate" : "Beginner",
                basedOnSkills: relatedSkills.length,
                method: "Weighted similarity-based estimation"
            },
            "Proficiency estimated using custom AI"
        )
    );
});

/**
 * Custom AI: Get model information (for FYP presentation)
 * GET /api/v1/ai/custom/model-info
 */
export const getCustomModelInfo = asyncHandler(async (req, res) => {
    const modelInfo = customAI.getModelInfo();

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                ...modelInfo,
                implementation: "Built from scratch in JavaScript",
                performanceMetrics: {
                    averageInferenceTime: "< 5ms",
                    embeddingDimension: 50,
                    supportedSkillCategories: 6
                },
                advantages: [
                    "No external API dependencies",
                    "Offline capability",
                    "Customizable for domain-specific needs",
                    "Fast inference",
                    "Educational demonstration of ML concepts"
                ]
            },
            "Custom AI model information retrieved"
        )
    );
});
