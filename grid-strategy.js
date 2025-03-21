// grid-strategy.js
class GridStrategy {
    constructor(orderManager, cacheManager, config) {
      this.orderManager = orderManager;
      this.cacheManager = cacheManager;
      this.config = config;
      this.running = false;
      this.updateInterval = null;
      this.statsInterval = null;
      this.lastPriceWarningTime = null;
      this.lastProcessedPrice = null;
      this.lastUpdateTime = null;
      this.lastBasePrice = null;
    }
    
    start() {
      if (this.running) return;
      
      this.running = true;
      console.log(`🚀 Démarrage de la stratégie de grid trading (${this.config.maxOrders} ordres max, palier de ${this.config.priceStep}$)`);
      
      // Initialiser les ordres au démarrage
      this.placeInitialOrders();
      
      // Récupérer l'intervalle de mise à jour depuis la configuration ou utiliser la valeur par défaut
      const updateInterval = this.config.strategy?.updateInterval || 250;
      
      // Mettre à jour les ordres plus fréquemment pour une meilleure réactivité
      this.updateInterval = setInterval(() => this.updateOrders(), updateInterval);
      console.log(`⏱️ Intervalle de mise à jour des ordres: ${updateInterval}ms pour une meilleure réactivité`);
      
      // Afficher les statistiques périodiquement (toutes les 5 minutes)
      this.statsInterval = setInterval(() => {
        this.cacheManager.logCacheStatus();
        this.orderManager.logStats();
      }, 5 * 60 * 1000);
    }
    
    stop() {
      if (!this.running) return;
      
      this.running = false;
      
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
      }
      
      if (this.statsInterval) {
        clearInterval(this.statsInterval);
        this.statsInterval = null;
      }
      
      console.log('⏹️ Arrêt de la stratégie de grid trading');
    }
    
    placeInitialOrders() {
      const currentPrice = this.cacheManager.getLastPrice();
      if (!currentPrice) {
        console.log("⚠️ Prix actuel non disponible, impossible de placer les ordres initiaux");
        return;
      }
      
      console.log(`📝 Placement des ordres initiaux (prix actuel: ${currentPrice}$)`);
      this.updateGridOrders(currentPrice);
    }
    
    updateOrders() {
      const currentPrice = this.cacheManager.getLastPrice();
      if (!currentPrice) {
        // Éviter de spammer les logs lors de la mise à jour fréquente
        if (!this.lastPriceWarningTime || Date.now() - this.lastPriceWarningTime > 10000) {
          console.log("⚠️ Prix actuel non disponible, mise à jour des ordres reportée");
          this.lastPriceWarningTime = Date.now();
        }
        return;
      }
      
      // Stocker le dernier prix traité pour éviter les mises à jour inutiles
      if (this.lastProcessedPrice === currentPrice && this.lastUpdateTime && 
          Date.now() - this.lastUpdateTime < 1000) {
        // Prix identique et mise à jour récente, pas besoin de recalculer
        return;
      }
      
      // Mettre à jour la grille avec le nouveau prix
      this.updateGridOrders(currentPrice);
      
      // Enregistrer le prix traité et l'heure
      this.lastProcessedPrice = currentPrice;
      this.lastUpdateTime = Date.now();
    }
    
    updateGridOrders(currentPrice) {
      // Calculer le prix de base (arrondi au palier inférieur)
      const basePrice = Math.floor(currentPrice / this.config.priceStep) * this.config.priceStep;
      
      // Vérifier si le prix de base a changé depuis la dernière mise à jour
      const priceHasChanged = this.lastBasePrice !== basePrice;
      
      // Mettre à jour le dernier prix de base
      this.lastBasePrice = basePrice;
      
      // Log uniquement si le prix de base a changé
      if (priceHasChanged) {
        console.log(`📊 Mise à jour de la grille - Prix actuel: ${currentPrice}$, Prix de base: ${basePrice}$`);
      }
      
      // Générer les paliers désirés - MODIFIÉ: commencer à i = 0 pour inclure le palier le plus proche
      const desiredLevels = [];
      for (let i = 0; i <= this.config.maxOrders - 1; i++) {
        desiredLevels.push(basePrice - i * this.config.priceStep);
      }
      
      // 1. Supprimer les ordres en trop ou trop éloignés (en masse)
      const removedCount = this.orderManager.enforceMaxOrders();
      if (removedCount > 0) {
        console.log(`🧹 ${removedCount} ordres éloignés ont été annulés`);
      }
      
      // 2. Filtrer pour ne garder que les nouveaux prix où on peut placer des ordres
      const newPriceLevels = [];
      for (const price of desiredLevels) {
        if (this.cacheManager.canPlaceOrder(price, this.config.priceStep)) {
          newPriceLevels.push(price);
        }
      }
      
      // 3. Placer les nouveaux ordres d'achat en vagues optimisées
      if (newPriceLevels.length > 0) {
        console.log(`✨ ${newPriceLevels.length} nouveaux ordres d'achat à placer`);
        
        this.orderManager.placeOrdersInWaves('buy', newPriceLevels)
          .then(placedCount => {
            console.log(`✅ ${placedCount} nouveaux ordres d'achat placés avec succès`);
          });
      } else if (priceHasChanged) {
        // Afficher ce message uniquement si le prix a changé et qu'il n'y a pas de nouveaux ordres
        console.log(`ℹ️ Aucun nouvel ordre d'achat à placer`);
      }
      
      // Afficher un résumé uniquement si des actions ont été entreprises ou si le prix a changé
      if (priceHasChanged || removedCount > 0 || newPriceLevels.length > 0) {
        console.log(`📈 Résumé de la mise à jour:
          - Prix actuel: ${currentPrice}$
          - Ordres d'achat actifs: ${this.cacheManager.buyCurrentOrders.size}
          - Ordres de vente actifs: ${this.cacheManager.sellCurrentOrders.size}
          - Ordres en attente de vente: ${this.cacheManager.buyFilledOrders.size}
          - Ordres annulés: ${removedCount}
          - Nouveaux ordres: ${newPriceLevels.length}
        `);
      }
    }
  }
  
  module.exports = GridStrategy;