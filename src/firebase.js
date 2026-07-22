import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Configuração do projeto Firebase (Configurações do projeto → Geral → Seus apps → Web).
// Esses valores são públicos por design do Firebase — identificam o projeto, mas não dão
// acesso a nada por si só (quem controla o acesso são as Regras do Firestore). Não são senha.
const firebaseConfig = {
  apiKey: "AIzaSyDb5cdh9O1kUjxbV4FMm0U_8u8gbZZXaFo",
  authDomain: "patrotintas-orcamento.firebaseapp.com",
  projectId: "patrotintas-orcamento",
  storageBucket: "patrotintas-orcamento.firebasestorage.app",
  messagingSenderId: "598331610249",
  appId: "1:598331610249:web:a50f942544db9dc8c82258",
};

export const firebaseConfigurado = firebaseConfig.apiKey !== "COLOQUE_AQUI";

export const db = firebaseConfigurado ? getFirestore(initializeApp(firebaseConfig)) : null;
