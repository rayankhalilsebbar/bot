// main.js
const config = require('./config');
const CacheManager = require('./cache-manager');
const WebSocketManager = require('./websocket-manager');
const OrderManager = require('./order-manager');
const GridStrategy = require('./grid-strategy');

async function main() {
  try {
    console.log("======= ROBOT DE TRADING GRID BITGET =======");
    console.log("Initialisation des composants...");
    
    // Initialiser les composants
    const cacheManager = new CacheManager();
    const wsManager = new WebSocketManager(config, cacheManager);
    const orderManager = new OrderManager(config, wsManager, cacheManager);
    const gridStrategy = new GridStrategy(orderManager, cacheManager, config);
    
    // Connexion aux WebSockets
    console.log("Connexion aux WebSockets BitGet...");
    const connected = await wsManager.connect();
    
    if (!connected) {
      throw new Error("Impossible de se connecter aux WebSockets BitGet");
    }
    
    // Attendre que le prix soit disponible
    console.log("Attente de la récupération du prix initial...");
    let attempts = 0;
    const maxAttempts = 20;
    
    while (!cacheManager.getLastPrice() && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
      process.stdout.write(".");
    }
    
    console.log("");
    
    if (!cacheManager.getLastPrice()) {
      throw new Error("Impossible de récupérer le prix initial après plusieurs tentatives");
    }
    
    console.log(`💰 Prix initial: ${cacheManager.getLastPrice()}$`);
    
    // Démarrer la stratégie
    setTimeout(() => {
      gridStrategy.start();
    }, 2000); // Petit délai pour s'assurer que tout est prêt
    
    console.log("======= ROBOT DE TRADING DÉMARRÉ AVEC SUCCÈS =======");
    
    // Gérer l'arrêt propre
    process.on('SIGINT', async () => {
      console.log("\n🛑 Arrêt du robot de trading...");
      gridStrategy.stop();
      wsManager.disconnect();
      
      // Afficher les statistiques finales
      cacheManager.logCacheStatus();
      orderManager.logStats();
      
      // Attendre un peu pour que les dernières actions se terminent
      setTimeout(() => {
        console.log("👋 Au revoir!");
        process.exit(0);
      }, 2000);
    });
    
  } catch (error) {
    console.error("❌ Erreur critique lors du démarrage du robot:", error);
    process.exit(1);
  }
}

// Démarrer le programme
main();