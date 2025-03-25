// config.js
module.exports = {
    // Paramètres de trading
    symbol: 'BTCUSDT',       // Symbole pour SPOT
    maxOrders: 10,          // Nombre maximum d'ordres actifs
    priceStep: 50,          // Écart entre les paliers en USD
    
    // MODIFICATION: Remplacer orderSize par orderAmountUSDT
    orderAmountUSDT: 50,    // Montant fixe en USDT pour chaque ordre (ex: 10 USDT)
    pricePrecision: 0,      // Nombre de décimales pour les prix (0 pour BTC/USDT)
    sizePrecision: 6,       // Nombre de décimales pour la taille des ordres (généralement 8 pour BTC)
    
    // Paramètres pour les ordres en masse
    massOrders: {
      waveSize: 49,          // Taille maximale d'une vague (max BitGet = 49)
      waveInterval: 1001     // Intervalle entre les vagues en ms
    },
    
    // Paramètres de la stratégie
    strategy: {
      updateInterval: 5,   // Intervalle de mise à jour de la grille en ms (plus réactif)
    },
    
    // Paramètres WebSocket
    wsEndpoints: {
      public: 'wss://ws.bitget.com/v2/ws/public',    // Point de terminaison WebSocket public V2
      private: 'wss://ws.bitget.com/v2/ws/private'   // Point de terminaison WebSocket privé V2
    },
    
    // Paramètres d'authentification
    apiKeys: {
      apiKey: process.env.BITGET_API_KEY || 'METTRE API KEY',
      secretKey: process.env.BITGET_SECRET_KEY || 'METTRE SECRET KEY',
      passphrase: process.env.BITGET_PASSPHRASE || 'METTRE PASSPHRASE'
    },
    
    // Paramètres de performance
    throttleRate: 49,       // Limiter à 49 messages par seconde
    reconnectInterval: 23 * 60 * 60 * 1000 + 50 * 60 * 1000,  // Reconnexion programmée (23h50m)
    pingInterval: 30000,     // Intervalle de ping/pong en ms
    
    // Paramètres de persistance
    persistence: {
      enabled: true,
      cacheFilePath: './data/cache.json',
      cacheSaveInterval: 60 * 1000  // 1 minute
    }
  };
