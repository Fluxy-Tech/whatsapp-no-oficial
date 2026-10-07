import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth";
import { deleteUserAvatar, getUserAvatar, uploadUserAvatar } from "../lib/s3";

// Profile photo of the logged user. The file lives in the private S3 bucket
// (one object per user, overwritten on change); user.image stores the path
// below, so the browser loads it through the backend.
const router = Router();

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (IMAGE_TYPES.includes(file.mimetype)) return callback(null, true);
    callback(new ProfileError(400, "Envie uma imagem JPG, PNG, WEBP ou GIF"));
  },
});

class ProfileError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

router.use(requireAuth);

/** Returns the path to save in user.image (the frontend saves it through better-auth). */
router.post("/avatar", upload.single("file"), async (req, res) => {
  if (!req.file) throw new ProfileError(400, 'Envie a imagem no campo "file"');
  const userId = req.session!.user.id;
  await uploadUserAvatar(userId, req.file.buffer, req.file.mimetype);
  // ?v= busts the browser cache: the object key is always the same.
  res.status(201).json({ image: `/api/profile/users/${userId}/avatar?v=${Date.now()}` });
});

router.delete("/avatar", async (req, res) => {
  await deleteUserAvatar(req.session!.user.id);
  res.status(204).end();
});

// Any logged user can see the photos (members, comment authors...).
router.get("/users/:userId/avatar", async (req, res) => {
  const avatar = await getUserAvatar(String(req.params.userId)).catch(() => null);
  if (!avatar) return res.status(404).end();
  res.setHeader("Content-Type", avatar.contentType);
  res.setHeader("Cache-Control", "private, max-age=86400");
  avatar.stream.pipe(res);
});

router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof ProfileError) return res.status(error.status).json({ error: error.message });
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ error: status === 413 ? "Imagem muito grande (máx. 5MB)" : error.message });
  }
  next(error);
});

export default router;
