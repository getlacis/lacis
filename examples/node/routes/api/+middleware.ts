import type { Request, Response } from "@/types";

// Utiliser une fonction non-async pour éviter la surcharge des promesses
export const beforeRequest = (req: Request, res: Response) => {
  // Utiliser setHeader mais seulement en production (pas de logs)
  res.setHeader('X-Root-Middleware', 'true');
  
  // En mode développement uniquement, journaliser à une faible fréquence
  // Par exemple, 1 requête sur 1000
  if (process.env.NODE_ENV === 'development' && Math.random() < 0.001) {
    console.log(`[ROOT] Request: ${req.method} ${req.url}`);
  }
  
  // Retourner true de manière synchrone
  return true;
};

// Utiliser une fonction non-async pour éviter la surcharge des promesses
export const afterRequest = (req: Request, res: Response) => {
  // En mode développement uniquement, journaliser à une faible fréquence
  if (process.env.NODE_ENV === 'development' && Math.random() < 0.001) {
    console.log(`[ROOT] Response sent with status: ${res.statusCode}`);
  }
  
  // Retourner true de manière synchrone
  return true;
};