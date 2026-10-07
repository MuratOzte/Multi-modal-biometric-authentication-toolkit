import torch
import clip
import cv2
import numpy as np
from PIL import Image

# --------------------------------
# DEVICE
# --------------------------------
device = "cuda" if torch.cuda.is_available() else "cpu"

# Model sadece bir kere yüklenecek
model, preprocess = clip.load("ViT-B/32", device=device)
model.eval()


# --------------------------------
# PREPROCESS
# --------------------------------
def preprocess_cv(image_path):
    img = cv2.imread(image_path)

    if img is None:
        raise ValueError(f"Görüntü okunamadı: {image_path}")

    # resize sabitle
    img = cv2.resize(img, (600, 400))

    # CLAHE (ışık düzeltme)
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=3.0)
    cl = clahe.apply(l)
    merged = cv2.merge((cl, a, b))
    img = cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)

    # blur azalt
    img = cv2.GaussianBlur(img, (3, 3), 0)

    return img


# --------------------------------
# FEATURE
# --------------------------------
def get_features(img_cv):
    img_pil = Image.fromarray(cv2.cvtColor(img_cv, cv2.COLOR_BGR2RGB))
    image = preprocess(img_pil).unsqueeze(0).to(device)

    with torch.no_grad():
        feat = model.encode_image(image)

    return feat / feat.norm(dim=-1, keepdim=True)


# --------------------------------
# VERIFY FUNCTION (main bunu çağıracak)
# --------------------------------
def verify_card(img1_path, img2_path, threshold=0.70):

    img1 = preprocess_cv(img1_path)
    img2 = preprocess_cv(img2_path)

    variants1 = [img1, cv2.flip(img1, 1)]
    variants2 = [img2, cv2.flip(img2, 1)]

    scores = []

    for v1 in variants1:
        for v2 in variants2:
            f1 = get_features(v1)
            f2 = get_features(v2)

            sim = (f1 @ f2.T).item()
            scores.append(sim)

    final_score = max(scores)

    print("\n--- Kart Analizi (CLIP) ---")
    print("CLIP MAX Score:", final_score)

    is_real = final_score > threshold

    return {
        "clip_score": final_score,
        "is_same_card": is_real
    }