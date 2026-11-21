
import firebase_admin
from firebase_admin import credentials, db

# Firebase настройки
cred = credentials.Certificate("serviceAccountKey.json")

firebase_admin.initialize_app(cred, {
    "databaseURL": "https://kebabposjp-1fec3-default-rtdb.asia-southeast1.firebasedatabase.app/"
})

def clear_node(path):
    ref = db.reference(path)
    ref.delete()
    print(f"Очищено: {path}")

if __name__ == "__main__":
    print("Firebase Realtime Database")
    print("--------------------------")

    confirm = input("Удалить все orders и sync_queue? (yes/no): ")

    if confirm.lower() == "yes":
        clear_node("orders")
        clear_node("sync_queue")
        print("\nГотово! counters сохранён.")
    else:
        print("Отменено.")
