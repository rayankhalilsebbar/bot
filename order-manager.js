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
      
      // Ajouter l'écouteur pour l'erreur de balance insuffisante
      this.wsManager.on('insufficient_balance', (orderDetails) => {
        this.handleInsufficientBalance(orderDetails);
      });
      
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
      this.cacheManager.addBuyOrder(clientOid, price, orderSize);
      
      // Envoyer l'ordre via WebSocket avec la taille calculée
      this.wsManager.placeOrder(clientOid, 'buy', price, orderSize);
      
      console.log(`💵 Ordre d'achat placé à ${price}$ pour ${orderSize} BTC (${this.config.orderAmountUSDT} USDT) (ID: ${clientOid})`);
      this.stats.ordersPlaced++;
      
      return clientOid;
    }
    
    placeSellOrder(price, size = null) {
      // Si size est fourni, l'utiliser; sinon calculer dynamiquement
      const orderSize = size !== null ? size : this.calculateOrderSize(price);
      
      console.log(`🔄 Placement d'un ordre de vente à ${price}$ pour ${orderSize} BTC ${size !== null ? "(quantité exacte de l'achat)" : `(${this.config.orderAmountUSDT} USDT)`}`);
      
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
      const currentPrice = this.cacheManager.getLastPrice();
      if (!currentPrice) {
        return 0; // Pas de prix disponible
      }
      
      console.log(`\n📊 DEBUG enforceMaxOrders: Analyse de la grille avec le prix actuel: ${currentPrice}$`);
      this.cacheManager.diagnoseCacheState();
      
      // Calculer le prix de base comme dans grid-strategy.js
      const basePrice = Math.floor(currentPrice / this.config.priceStep) * this.config.priceStep;
      
      // Générer les niveaux de prix désirés pour la grille actuelle
      const desiredPrices = new Set();
      console.log(`📊 DEBUG enforceMaxOrders: Prix actuel ${currentPrice}$, Prix de base ${basePrice}$`);
      console.log(`📊 DEBUG enforceMaxOrders: Création de la grille avec ${this.config.maxOrders} niveaux`);
      
      for (let i = 0; i < this.config.maxOrders; i++) {
        const priceLevel = basePrice - i * this.config.priceStep;
        desiredPrices.add(priceLevel);
        console.log(`📊 DEBUG enforceMaxOrders: Niveau #${i+1}: ${priceLevel}$`);
      }
      
      // Identifier les ordres qui ne font pas partie de la grille actuelle
      const ordersToCancel = [];
      console.log(`📊 DEBUG enforceMaxOrders: Analyse des ${this.cacheManager.buyCurrentOrders.size} ordres actifs`);
      
      // Créer un tableau des ordres pour l'affichage
      const allCurrentOrders = [];
      for (const [clientOid, orderInfo] of this.cacheManager.buyCurrentOrders.entries()) {
        if (orderInfo.status === 'live' || orderInfo.status === 'pending') {
          allCurrentOrders.push({
            clientOid,
            price: orderInfo.price,
            status: orderInfo.status,
            inGrid: desiredPrices.has(orderInfo.price)
          });
        }
      }
      
      // Trier le tableau par prix pour faciliter la visualisation
      allCurrentOrders.sort((a, b) => b.price - a.price);
      console.log(`📊 DEBUG enforceMaxOrders: État actuel des ordres:`);
      allCurrentOrders.forEach(order => {
        console.log(`   - ${order.clientOid}: ${order.price}$ (${order.status}) - ${order.inGrid ? 'dans la grille' : 'HORS GRILLE'}`);
      });
      
      for (const [clientOid, orderInfo] of this.cacheManager.buyCurrentOrders.entries()) {
        if (orderInfo.status !== 'live' && orderInfo.status !== 'pending') {
          continue;
        }
        
        // Vérifier si ce prix est dans la grille actuelle
        if (!desiredPrices.has(orderInfo.price)) {
          ordersToCancel.push(clientOid);
          console.log(`🧹 Ordre ${clientOid} à ${orderInfo.price}$ ne fait pas partie de la grille actuelle - à annuler`);
        }
      }
      
      if (ordersToCancel.length === 0) {
        console.log(`✅ DEBUG enforceMaxOrders: Aucun ordre à annuler, tous les ordres font partie de la grille actuelle`);
        return 0; // Aucun ordre à annuler
      }
      
      console.log(`🔄 Annulation ciblée de ${ordersToCancel.length} ordres hors grille actuelle`);
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
      
      const { price, clientOid, size } = data;
      
      if (!price) {
        console.error(`❌ Prix manquant dans les données d'ordre rempli:`, data);
        return;
      }
      
      if (!size) {
        console.error(`❌ Taille manquante dans les données d'ordre rempli:`, data);
        return;
      }
      
      // IMPORTANT: Incrémenter le compteur d'ordres d'achat remplis
      this.stats.buyOrdersFilled++;
      console.log(`📊 Mise à jour des statistiques: ${this.stats.buyOrdersFilled} ordres d'achat remplis`);
      
      // Calcul du prix de vente (prix d'achat + palier)
      const sellPrice = parseFloat((price + this.config.priceStep).toFixed(this.config.pricePrecision || 0));
      
      console.log(`✅ Ordre d'achat ${clientOid} EXÉCUTÉ à ${price}$ pour ${size} BTC. PLACEMENT d'un ordre de vente à ${sellPrice}$ pour la même quantité exacte`);
      
      // Placement de l'ordre de vente
      try {
        // Utiliser la taille exacte pour l'ordre de vente
        const sellOrderResult = this.placeSellOrder(sellPrice, size);
        console.log(`✨ Ordre de vente PLACÉ avec succès à ${sellPrice}$ pour ${size} BTC:`, sellOrderResult);
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
        
        // Ajouter l'ordre au cache AVANT de l'envoyer - maintenant avec la taille
        this.cacheManager.addBuyOrder(clientOid, price, orderSize);
        
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
        
        // Récupérer la configuration des vagues - CRUCIAL: Intervalle de 1001ms
        const waveSize = this.config.massOrders?.waveSize || 49;
        const waveInterval = this.config.massOrders?.waveInterval || 1001; // EXACTEMENT 1001ms
        
        // Division en vagues de 49 ordres maximum
        const waves = [];
        for (let i = 0; i < ordersData.length; i += waveSize) {
          waves.push(ordersData.slice(i, Math.min(i + waveSize, ordersData.length)));
        }
        
        console.log(`🌊 Préparation de ${ordersData.length} ordres ${side} sur ${waves.length} vagues (intervalle: ${waveInterval}ms)`);
        
        let totalOrdersPlaced = 0;
        let currentWaveIndex = 0;
        
        // MODIFICATION IMPORTANTE: Fonction pour envoyer une seule vague
        const sendWave = () => {
          const currentWave = waves[currentWaveIndex];
          const waveNum = currentWaveIndex + 1;
          console.log(`🌊 Envoi de la vague ${side} #${waveNum}/${waves.length} (${currentWave.length} ordres) à ${new Date().toISOString()}`);
          
          // Envoyer les ordres selon le type
          let ordersPlaced = 0;
          if (side.toLowerCase() === 'buy') {
            ordersPlaced = this.placeBulkBuyOrders(currentWave);
          } else if (side.toLowerCase() === 'sell') {
            ordersPlaced = this.placeBulkSellOrders(currentWave);
          }
          
          totalOrdersPlaced += ordersPlaced;
          console.log(`✅ Vague ${waveNum} terminée: ${ordersPlaced}/${currentWave.length} ordres envoyés`);
        };
        
        // MODIFICATION IMPORTANTE: Envoyer la première vague immédiatement
        sendWave();
        
        // MODIFICATION IMPORTANTE: Planifier les vagues suivantes exactement comme dans mass_orders.js
        const intervalId = setInterval(() => {
          currentWaveIndex++;
          
          if (currentWaveIndex < waves.length) {
            // Envoyer la vague suivante
            sendWave();
          } else {
            // Toutes les vagues ont été envoyées
            clearInterval(intervalId);
            console.log(`✅ Toutes les vagues d'ordres ${side} ont été envoyées! Total: ${totalOrdersPlaced}/${ordersData.length} ordres`);
            resolve(totalOrdersPlaced);
          }
        }, waveInterval);
      });
    }
    
    // Nouvelle méthode pour gérer l'erreur de balance insuffisante
    async handleInsufficientBalance(orderDetails) {
      // Vérifier si on est déjà en train de gérer une erreur de balance insuffisante
      if (this.isHandlingInsufficientBalance) {
        console.log("⚠️ Une gestion d'erreur de balance insuffisante est déjà en cours");
        return;
      }

      this.isHandlingInsufficientBalance = true;
      const failedOrderPrice = parseFloat(orderDetails.price);
      console.log(`🔄 Gestion de l'erreur de balance insuffisante pour l'ordre à ${failedOrderPrice}$`);
      
      try {
        // Récupérer tous les ordres d'achat actifs
        const activeBuyOrders = this.cacheManager.getActiveBuyOrdersSortedByDistance(failedOrderPrice);
        
        if (activeBuyOrders.length === 0) {
          console.log("❌ Aucun ordre d'achat actif trouvé pour gérer l'erreur de balance insuffisante");
          return;
        }

        // Filtrer pour ne garder que les ordres dont le prix est inférieur au prix qui a échoué
        const eligibleOrders = activeBuyOrders.filter(order => order.price < failedOrderPrice);

        if (eligibleOrders.length === 0) {
          console.log(`❌ Aucun ordre d'achat éligible trouvé pour l'annulation (prix < ${failedOrderPrice}$)`);
          return;
        }
        
        // Prendre le premier ordre éligible (le plus éloigné parmi ceux qui sont inférieurs au prix d'échec)
        const furthestOrder = eligibleOrders[0];
        
        // Créer une promesse qui se résout quand l'ordre est annulé ou après un timeout
        const cancelPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Timeout lors de l'annulation de l'ordre"));
          }, 2000);

          const onOrderCancelled = (cancelledOrder) => {
            if (cancelledOrder.clientOid === furthestOrder.clientOid) {
              clearTimeout(timeout);
              this.wsManager.removeListener('order_cancelled', onOrderCancelled);
              resolve();
            }
          };

          this.wsManager.on('order_cancelled', onOrderCancelled);
        });

        // Annuler l'ordre et attendre la confirmation
        console.log(`🔄 Annulation de l'ordre le plus éloigné (${furthestOrder.price}$) pour libérer des fonds`);
        await this.cancelOrder(furthestOrder.clientOid);
        await cancelPromise;
        
        // Réessayer de placer l'ordre qui a échoué
        console.log(`🔄 Nouvelle tentative de placement de l'ordre à ${failedOrderPrice}$`);
        await this.placeBuyOrder(failedOrderPrice);
      } catch (error) {
        console.error(`❌ Erreur lors de la gestion de l'erreur de balance insuffisante:`, error);
      } finally {
        this.isHandlingInsufficientBalance = false;
      }
    }
  }
  
  module.exports = OrderManager;