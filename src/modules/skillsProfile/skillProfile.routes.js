import { Router } from "express";
import { validateRequest } from "../../middlewares/validate.middleware.js";
import { offeredSkillSchema, requiredSkillSchema, skillTradingQuerySchema } from "./skillProfile.validator.js";
import { 
    addOfferedSkill, 
    addRequiredSkill, 
    getMyOfferedSkills, 
    getMyRequiredSkills, 
    getUserDetailsForTrading, 
    getUsersForSkillTrading,
    deleteOfferedSkill,
    deleteRequiredSkill
} from "./skillProfile.controller.js";
import { verifyJwt } from "../../middlewares/auth.middleware.js";


const router = Router();

router.get("/my-offered-skill", verifyJwt, getMyOfferedSkills);

router.post("/my-required-skill", verifyJwt, getMyRequiredSkills);

router.post("/add-offered-skill", verifyJwt, validateRequest(offeredSkillSchema), addOfferedSkill);

router.post("/add-required-skill", verifyJwt, validateRequest(requiredSkillSchema), addRequiredSkill);

// Delete skill routes
router.delete("/offered-skill/:skillId", verifyJwt, deleteOfferedSkill);

router.delete("/required-skill/:skillId", verifyJwt, deleteRequiredSkill);

router.get("/users-for-trading", verifyJwt, validateRequest(skillTradingQuerySchema, "query"), getUsersForSkillTrading);

router.get("/users-for-trading/:id", verifyJwt, getUserDetailsForTrading);


export default router;