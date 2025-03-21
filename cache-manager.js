// cache-manager.js
class CacheManager {
    constructor() {
      // Cache des ordres d'achat actifs (clientOid -> { price, status })
      this.buyCurrentOrders = new Map();
      
      // Cache des ordres de vente actifs (price -> clientOid)
      this.sellCurrentOrders = new Map();
      
      // Cache des achats complétés en attente de vente (price -> details)
      this.buyFilledOrders = new Map();
      
      // Cache du dernier prix connu
      this.lastPrice = null;
      this.lastPriceTimestamp = null;
    }
    
    // Mise à jour du prix
    updatePrice(price) {
      this.lastPrice = price;
      this.lastPriceTimestamp = Date.now();
      return this.lastPrice;
    }
    
    getLastPrice() {
      return this.lastPrice;
    }
    
    // Méthodes pour les ordres d'achat
    addBuyOrder(clientOid, price) {
      this.buyCurrentOrders.set(clientOid, {
        price: price,
        status: 'pending',
        timestamp: Date.now()
      });
      console.log(`💾 Ajout au cache d'un ordre d'achat: ${clientOid} à ${price}$`);
    }
    
    updateBuyOrderStatus(clientOid, status) {
      if (this.buyCurrentOrders.has(clientOid)) {
        const order = this.buyCurrentOrders.get(clientOid);
        order.status = status;
        this.buyCurrentOrders.set(clientOid, order);
        console.log(`💾 Mise à jour du statut de l'ordre ${clientOid} à "${status}"`);
      }
    }
    
    removeBuyOrder(clientOid) {
      if (this.buyCurrentOrders.has(clientOid)) {
        const order = this.buyCurrentOrders.get(clientOid);
        this.buyCurrentOrders.delete(clientOid);
        console.log(`💾 Suppression de l'ordre d'achat du cache: ${clientOid}`);
        return order;
      }
      return null;
    }
    
    // Méthodes pour les ordres de vente
    addSellOrder(price, orderInfo) {
      // Si orderInfo est une chaîne (ancienne version), la convertir en objet
      const orderDetails = typeof orderInfo === 'string' 
        ? { clientOid: orderInfo, status: 'pending', timestamp: Date.now() }
        : orderInfo;
      
      this.sellCurrentOrders.set(price, orderDetails);
      console.log(`💾 Ajout au cache d'un ordre de vente: ${orderDetails.clientOid} à ${price}$`);
    }
    
    removeSellOrder(price) {
      if (this.sellCurrentOrders.has(price)) {
        const orderInfo = this.sellCurrentOrders.get(price);
        const clientOid = typeof orderInfo === 'string' ? orderInfo : orderInfo.clientOid;
        
        this.sellCurrentOrders.delete(price);
        console.log(`💾 Suppression de l'ordre de vente du cache à ${price}$`);
        
        return orderInfo;  // Renvoyer l'objet complet ou la chaîne
      }
      return null;
    }
    
    // Méthodes pour les ordres d'achat complétés
    addFilledBuyOrder(price, details) {
      this.buyFilledOrders.set(price, details);
      console.log(`💾 Ajout au cache d'un achat complété à ${price}$`);
    }
    
    removeFilledBuyOrder(price) {
      if (this.buyFilledOrders.has(price)) {
        const details = this.buyFilledOrders.get(price);
        this.buyFilledOrders.delete(price);
        console.log(`💾 Suppression de l'achat complété du cache à ${price}$`);
        return details;
      }
      return null;
    }
    
    // Vérifier si un ordre peut être placé à un prix donné
    canPlaceOrder(price, step) {
      // Vérifier qu'il n'y a pas déjà un ordre d'achat à ce prix
      for (let order of this.buyCurrentOrders.values()) {
        if (order.price === price) {
          return false; // Un ordre à ce prix existe déjà
        }
      }
      
      // Vérifier qu'il n'y a pas d'ordre de vente au palier supérieur
      const sellPrice = price + step;
      if (this.sellCurrentOrders.has(sellPrice)) {
        return false; // Un ordre de vente existe déjà à ce prix
      }
      
      // Vérifier que ce palier n'est pas déjà utilisé par un ordre complété en attente de vente
      if (this.buyFilledOrders.has(price)) {
        return false; // Ordre déjà exécuté, en attente de revente
      }
      
      return true; // Toutes les conditions sont remplies
    }
    
    // Obtenir les ordres d'achat à annuler en cas de dépassement
    getOrdersToCancel(maxOrders) {
      if (this.buyCurrentOrders.size <= maxOrders) {
        return [];
      }
      
      // CORRECTION: Trier par prix (du plus bas au plus élevé)
      // pour que les prix les plus bas (éloignés) soient en premier
      const sortedOrders = [...this.buyCurrentOrders.entries()]
        .sort((a, b) => a[1].price - b[1].price);
      
      // Extraire les ordres à supprimer (les plus éloignés du prix actuel)
      const excessOrders = this.buyCurrentOrders.size - maxOrders;
      
      // Renvoyer les clientOid des ordres les plus éloignés
      return sortedOrders.slice(0, excessOrders).map(entry => entry[0]);
    }
    
    // Méthodes de statistiques
    getStats() {
      return {
        lastPrice: this.lastPrice,
        lastPriceTimestamp: this.lastPriceTimestamp,
        buyOrdersCount: this.buyCurrentOrders.size,
        sellOrdersCount: this.sellCurrentOrders.size,
        filledOrdersCount: this.buyFilledOrders.size
      };
    }
    
    // Affichage de l'état du cache
    logCacheStatus() {
      console.log(`
  ===== ÉTAT DU CACHE =====
  Prix actuel: ${this.lastPrice}$
  Ordres d'achat actifs: ${this.buyCurrentOrders.size}
  Ordres de vente actifs: ${this.sellCurrentOrders.size}
  Achats complétés en attente: ${this.buyFilledOrders.size}
  =========================
      `);
    }
    
    // Méthode générique pour mettre à jour le statut d'un ordre
    updateOrderStatus(clientOid, status, side) {
      console.log(`📝 Mise à jour du statut de l'ordre ${clientOid} à ${status}`);
      
      if (side === 'buy' || side.toLowerCase() === 'buy') {
        if (this.buyCurrentOrders.has(clientOid)) {
          const order = this.buyCurrentOrders.get(clientOid);
          order.status = status;
          this.buyCurrentOrders.set(clientOid, order);
          console.log(`✅ Statut de l'ordre d'achat ${clientOid} mis à jour: ${status}`);
          return true;
        }
      } else if (side === 'sell' || side.toLowerCase() === 'sell') {
        // Pour les ordres de vente, nous devons parcourir toutes les entrées
        // car sellCurrentOrders est indexé par prix et non par clientOid
        for (const [price, orderInfo] of this.sellCurrentOrders.entries()) {
          const orderClientOid = typeof orderInfo === 'string' ? orderInfo : orderInfo.clientOid;
          
          if (orderClientOid === clientOid) {
            // Si orderInfo est une chaîne, convertir en objet
            if (typeof orderInfo === 'string') {
              const newOrderInfo = {
                clientOid: orderInfo,
                price: parseFloat(price),
                status: status,
                timestamp: Date.now()
              };
              this.sellCurrentOrders.set(price, newOrderInfo);
            } else {
              // Si c'est déjà un objet, mettre à jour le statut
              orderInfo.status = status;
              this.sellCurrentOrders.set(price, orderInfo);
            }
            console.log(`✅ Statut de l'ordre de vente ${clientOid} mis à jour: ${status}`);
            return true;
          }
        }
      }
      
      console.log(`⚠️ Ordre ${clientOid} non trouvé dans le cache, impossible de mettre à jour le statut`);
      return false;
    }
  }
  
  module.exports = CacheManager;