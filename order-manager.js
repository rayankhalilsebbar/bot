// order-manager.js
class OrderManager {
    constructor(config, wsManager, cacheManager) {
      this.config = config;
      this.wsManager = wsManager;
      this.cacheManager = cacheManager;
      
      // Statistiques
      this.stats = {
        ordersPlaced: 0,
        ordersCancelled: 0,
        buyOrdersFilled: 0,
        sellOrdersFilled: 0
      };
      
      // IMPORTANT: Configurer les écouteurs IMMÉDIATEMENT
      this.setupEventListeners();
      
      console.log('🔄 Gestionnaire d\'ordres initialisé avec écouteurs configurés');
    }
    
    setupEventListeners() {
      console.log('📡 Configuration des écouteurs d\'événements');
      
      // IMPORTANT: Utiliser des fonctions fléchées pour préserver le contexte 'this'
      this.wsManager.on('buy_order_filled', (data) => {
        console.log(`🔔 RÉCEPTION de l'événement buy_order_filled:`, JSON.stringify(data));
        this.handleBuyOrderFilled(data);
      });
      
      // Autres écouteurs
      this.wsManager.on('sell_order_filled', (data) => {
        console.log(`🔔 Événement sell_order_filled reçu:`, JSON.stringify(data));
        this.handleSellOrderFilled(data);
      });
      
      // Vérifier que les écouteurs sont bien configurés
      const listenerCount = this.wsManager.listenerCount('buy_order_filled');
      console.log(`📡 Nombre d'écouteurs pour buy_order_filled: ${listenerCount}`);
      
      if (listenerCount === 0) {
        console.error(`❌ ERREUR: Aucun écouteur n'a été configuré pour buy_order_filled!`);
      }
    }
    
    placeBuyOrder(price) {
      // Vérifier si on peut placer un ordre à ce prix
      if (!this.cacheManager.canPlaceOrder(price, this.config.priceStep)) {
        return null;
      }
      
      // MODIFICATION: Calculer la taille dynamiquement
      const orderSize = this.calculateOrderSize(price);
      
      // Générer un ID client unique
      const clientOid = `buy_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      
      // Ajouter l'ordre au cache d'ordres d'achat AVANT d'envoyer la requête
      this.cacheManager.addBuyOrder(clientOid, price);
      
      // Envoyer l'ordre via WebSocket avec la taille calculée
      this.wsManager.placeOrder(clientOid, 'buy', price, orderSize);
      
      console.log(`💵 Ordre d'achat placé à ${price}$ pour ${orderSize} BTC (${this.config.orderAmountUSDT} USDT) (ID: ${clientOid})`);
      this.stats.ordersPlaced++;
      
      return clientOid;
    }
    
    placeSellOrder(price) {
      // MODIFICATION: Calculer la taille dynamiquement
      const orderSize = this.calculateOrderSize(price);
      
      console.log(`🔄 Placement d'un ordre de vente à ${price}$ pour ${orderSize} BTC (${this.config.orderAmountUSDT} USDT)`);
      
      const clientOid = `sell_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      
      try {
        // Envoi de l'ordre via WebSocket
        this.wsManager.placeOrder(clientOid, 'sell', price, orderSize);
        
        // Ajouter l'ordre au cache
        this.cacheManager.addSellOrder(price, {
          clientOid,
          price,
          size: orderSize,
          status: 'pending',
          timestamp: Date.now()
        });
        
        console.log(`📝 Ordre de vente enregistré: ${clientOid}`);
        
        // Incrémenter le compteur d'ordres placés
        this.stats.ordersPlaced++;
        
        return clientOid;
      } catch (error) {
        console.error(`❌ Erreur lors du placement de l'ordre de vente:`, error);
        throw error;
      }
    }
    
    cancelOrder(clientOid) {
      // Vérifier que clientOid est une chaîne
      if (typeof clientOid !== 'string') {
        console.error(`⚠️ Erreur: Tentative d'annulation avec un clientOid non valide:`, clientOid);
        return false;
      }
      
      // Envoyer l'annulation via WebSocket
      const success = this.wsManager.cancelOrder(clientOid);
      
      if (success) {
        console.log(`❌ Annulation de l'ordre demandée: ${clientOid}`);
        this.stats.ordersCancelled++;
      }
      
      return success;
    }
    
    // Gérer un nombre maximum d'ordres d'achat
    enforceMaxOrders() {
      const ordersToCancel = this.cacheManager.getOrdersToCancel(this.config.maxOrders);
      
      if (ordersToCancel.length === 0) {
        return 0; // Aucun ordre à annuler
      }
      
      console.log(`🔄 Annulation en masse de ${ordersToCancel.length} ordres trop éloignés du prix actuel`);
      const cancelledCount = this.wsManager.cancelBulkOrders(ordersToCancel);
      
      // Mise à jour des statistiques
      this.stats.ordersCancelled += cancelledCount;
      return cancelledCount;
    }
    
    // Améliorer le callback pour un ordre d'achat exécuté
    handleBuyOrderFilled(data) {
      console.log(`🎯 DÉBUT du traitement de l'ordre d'achat rempli:`, JSON.stringify(data));
      
      if (!data) {
        console.error('❌ Données d\'ordre rempli invalides ou manquantes');
        return;
      }
      
      const { price, clientOid } = data;
      
      if (!price) {
        console.error(`❌ Prix manquant dans les données d'ordre rempli:`, data);
        return;
      }
      
      // IMPORTANT: Incrémenter le compteur d'ordres d'achat remplis
      this.stats.buyOrdersFilled++;
      console.log(`📊 Mise à jour des statistiques: ${this.stats.buyOrdersFilled} ordres d'achat remplis`);
      
      // Calcul du prix de vente (prix d'achat + palier)
      const sellPrice = parseFloat((price + this.config.priceStep).toFixed(this.config.pricePrecision || 0));
      
      console.log(`✅ Ordre d'achat ${clientOid} EXÉCUTÉ à ${price}$. PLACEMENT d'un ordre de vente à ${sellPrice}$`);
      
      // Placement de l'ordre de vente
      try {
        // La taille sera calculée dynamiquement dans placeSellOrder
        const sellOrderResult = this.placeSellOrder(sellPrice);
        console.log(`✨ Ordre de vente PLACÉ avec succès à ${sellPrice}$:`, sellOrderResult);
      } catch (error) {
        console.error(`❌ ÉCHEC du placement de l'ordre de vente à ${sellPrice}$:`, error);
      }
    }
    
    // Callback pour un ordre de vente exécuté
    handleSellOrderFilled(data) {
      const { price, size } = data;
      
      // Incrémenter le compteur d'ordres de vente remplis
      this.stats.sellOrdersFilled++;
      
      console.log(`✅ Ordre de vente exécuté à ${price}$`);
    }
    
    // Afficher les statistiques des ordres
    logStats() {
      console.log(`
        📊 STATISTIQUES DES ORDRES 📊
        --------------------------------
        Ordres placés          : ${this.stats.ordersPlaced}
        Ordres annulés         : ${this.stats.ordersCancelled}
        Ordres d'achat remplis : ${this.stats.buyOrdersFilled}
        Ordres de vente remplis: ${this.stats.sellOrdersFilled}
        --------------------------------
      `);
    }
    
    calculateOrderSize(price) {
      // Calculer la taille en BTC (montant USDT / prix BTC)
      const rawSize = this.config.orderAmountUSDT / price;
      
      // Appliquer la précision définie dans la configuration
      const precision = this.config.sizePrecision || 6;
      const formattedSize = parseFloat(rawSize.toFixed(precision));
      
      console.log(`💱 Calcul de la taille d'ordre: ${this.config.orderAmountUSDT} USDT ÷ ${price}$ = ${formattedSize} BTC`);
      
      return formattedSize;
    }
    
    // Méthode pour placer des ordres d'achat en masse
    placeBulkBuyOrders(pricesData) {
      const orders = [];
      let orderCount = 0;
      
      for (const price of pricesData) {
        if (!this.cacheManager.canPlaceOrder(price, this.config.priceStep)) {
          continue; // Ignorer ce prix si on ne peut pas y placer d'ordre
        }
        
        // Calculer la taille dynamiquement
        const orderSize = this.calculateOrderSize(price);
        
        // Générer un ID client unique
        const clientOid = `buy_${Date.now()}_${Math.floor(Math.random() * 10000)}_${orderCount++}`;
        
        // Ajouter l'ordre au cache AVANT de l'envoyer
        this.cacheManager.addBuyOrder(clientOid, price);
        
        // Préparer l'ordre pour l'envoi en masse
        orders.push({
          clientOid,
          side: 'buy',
          price,
          size: orderSize
        });
        
        // Incrémenter les statistiques
        this.stats.ordersPlaced++;
      }
      
      // Si aucun ordre n'a été préparé, sortir
      if (orders.length === 0) {
        return 0;
      }
      
      // Envoyer tous les ordres préparés en une seule fois
      const placedCount = this.wsManager.placeBulkOrders(orders);
      
      console.log(`💵 ${placedCount} ordres d'achat en masse placés sur ${orders.length} préparés`);
      
      return placedCount;
    }
    
    // Méthode pour placer des ordres de vente en masse
    placeBulkSellOrders(pricesData) {
      const orders = [];
      let orderCount = 0;
      
      for (const price of pricesData) {
        // Calculer la taille dynamiquement
        const orderSize = this.calculateOrderSize(price);
        
        // Générer un ID client unique
        const clientOid = `sell_${Date.now()}_${Math.floor(Math.random() * 10000)}_${orderCount++}`;
        
        // Préparer l'ordre pour l'envoi en masse
        orders.push({
          clientOid,
          side: 'sell',
          price,
          size: orderSize
        });
        
        // Ajouter l'ordre au cache
        this.cacheManager.addSellOrder(price, {
          clientOid,
          price,
          size: orderSize,
          status: 'pending',
          timestamp: Date.now()
        });
        
        // Incrémenter les statistiques
        this.stats.ordersPlaced++;
      }
      
      // Si aucun ordre n'a été préparé, sortir
      if (orders.length === 0) {
        return 0;
      }
      
      // Envoyer tous les ordres préparés en une seule fois
      const placedCount = this.wsManager.placeBulkOrders(orders);
      
      console.log(`📈 ${placedCount} ordres de vente en masse placés sur ${orders.length} préparés`);
      
      return placedCount;
    }
    
    // Méthode optimisée pour placer des ordres en vagues
    placeOrdersInWaves(side, ordersData) {
      return new Promise((resolve) => {
        if (!ordersData || ordersData.length === 0) {
          console.log(`⚠️ Aucune donnée fournie pour le placement d'ordres ${side} en vagues`);
          resolve(0);
          return;
        }
        
        // Récupérer la configuration des vagues
        const waveSize = this.config.massOrders?.waveSize || 49;
        const waveInterval = this.config.massOrders?.waveInterval || 1001;
        
        // Optimiser la répartition des ordres
        const waves = this.generateOptimizedWaves(ordersData, waveSize);
        
        console.log(`🌊 Placement de ${ordersData.length} ordres ${side} sur ${waves.length} vagues optimisées (intervalle: ${waveInterval}ms)`);
        waves.forEach((wave, index) => {
          console.log(`   - Vague ${index + 1}: ${wave.length} ordres`);
        });
        
        let totalOrdersPlaced = 0;
        let currentWave = 0;
        
        // Fonction pour envoyer une vague d'ordres
        const sendWave = () => {
          if (currentWave >= waves.length) {
            console.log(`✅ Toutes les vagues d'ordres ${side} ont été envoyées! Total: ${totalOrdersPlaced} ordres`);
            resolve(totalOrdersPlaced);
            return;
          }
          
          const waveData = waves[currentWave];
          console.log(`🌊 Envoi de la vague ${side} #${currentWave + 1}/${waves.length} (${waveData.length} ordres)`);
          
          let ordersPlaced = 0;
          
          if (side.toLowerCase() === 'buy') {
            ordersPlaced = this.placeBulkBuyOrders(waveData);
          } else if (side.toLowerCase() === 'sell') {
            ordersPlaced = this.placeBulkSellOrders(waveData);
          }
          
          totalOrdersPlaced += ordersPlaced;
          currentWave++;
          
          // Planifier la prochaine vague
          setTimeout(sendWave, waveInterval);
        };
        
        // Démarrer l'envoi de la première vague
        sendWave();
      });
    }
    
    // Méthode pour optimiser la répartition des ordres en vagues
    generateOptimizedWaves(ordersData, maxPerWave) {
      const totalOrders = ordersData.length;
      
      // S'assurer que maxPerWave ne dépasse pas 49 (limite de BitGet)
      const safeMaxPerWave = Math.min(maxPerWave, 49);
      
      // Cas simple: tous les ordres tiennent dans une seule vague
      if (totalOrders <= safeMaxPerWave) {
        return [ordersData];
      }
      
      // Stratégie pour éviter les petites vagues
      const waves = [];
      
      // Si la dernière vague aurait moins de 25% de capacité, la redistribuer
      const lastWaveSize = totalOrders % safeMaxPerWave;
      const redistributeLastWave = lastWaveSize > 0 && lastWaveSize < safeMaxPerWave * 0.25;
      
      if (redistributeLastWave) {
        // Calculer combien de vagues complètes
        const fullWaves = Math.floor(totalOrders / safeMaxPerWave);
        
        if (fullWaves >= 1) {
          // Nouvelle taille pour répartir les ordres de façon optimale
          const ordersPerWave = Math.ceil(totalOrders / fullWaves);
          const safeOrdersPerWave = Math.min(ordersPerWave, safeMaxPerWave);
          
          // Répartir les ordres en vagues optimisées
          for (let i = 0; i < totalOrders; i += safeOrdersPerWave) {
            waves.push(ordersData.slice(i, Math.min(i + safeOrdersPerWave, totalOrders)));
          }
          
          return waves;
        }
      }
      
      // Distribution standard par vagues de 49 ordres (ou moins)
      for (let i = 0; i < totalOrders; i += safeMaxPerWave) {
        waves.push(ordersData.slice(i, Math.min(i + safeMaxPerWave, totalOrders)));
      }
      
      return waves;
    }
  }
  
  module.exports = OrderManager;