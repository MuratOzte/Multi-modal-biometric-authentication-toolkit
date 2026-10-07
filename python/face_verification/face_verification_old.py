from facenet_pytorch import MTCNN, InceptionResnetV1
from PIL import Image
import torch
from sklearn.metrics.pairwise import cosine_similarity

device = 'cuda' if torch.cuda.is_available() else 'cpu'

mtcnn = MTCNN(image_size=160, margin=20, device=device)
resnet = InceptionResnetV1(pretrained='vggface2').eval().to(device)


def verify_face(img1_path, img2_path, threshold=0.6):

    # 🔥 RGB ZORUNLU (4 kanal hatasını çözer)
    img1 = Image.open(img1_path).convert("RGB")
    img2 = Image.open(img2_path).convert("RGB")

    face1 = mtcnn(img1)
    face2 = mtcnn(img2)

    if face1 is None or face2 is None:
        print("⚠️ Yüz tespit edilemedi.")
        return {"match": False, "score": 0.0}

    emb1 = resnet(face1.unsqueeze(0).to(device)).detach().cpu().numpy()
    emb2 = resnet(face2.unsqueeze(0).to(device)).detach().cpu().numpy()

    score = cosine_similarity(emb1, emb2)[0][0]

    print("\n--- Yüz Doğrulama (FaceNet) ---")
    print("Face Score:", score)

    return {
        "score": float(score),
        "match": score > threshold
    }


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 3:
        print("Usage: python face_verification_old.py <img1> <img2> [threshold]")
        sys.exit(1)

    img1_path = sys.argv[1]
    img2_path = sys.argv[2]
    threshold = float(sys.argv[3]) if len(sys.argv) > 3 else 0.6

    result = verify_face(img1_path, img2_path, threshold)
    print(result)