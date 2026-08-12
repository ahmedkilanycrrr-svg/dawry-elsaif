// خطوات الحصول على البيانات دي موجودة بالتفصيل في README.md
// هتلاقيها لما تعمل مشروع Firebase وتضيف "تطبيق ويب" جواه

const firebaseConfig = {
  apiKey: "AIzaSyArZQ69poq8xTz_4csw7TShTylFqvBiW_o",
  authDomain: "dawry-elsaif.firebaseapp.com",
  projectId: "dawry-elsaif",
  storageBucket: "dawry-elsaif.firebasestorage.app",
  messagingSenderId: "577241873026",
  appId: "1:577241873026:web:3060d5f6fcfbb22ec9929b"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const docRef = db.collection("tournament").doc("data");
