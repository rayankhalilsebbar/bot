// cache-manager.js
const fs = require('fs');
const path = require('path');

class CacheManager {
    constructor(config) {
      // Configuration
      this.config = config || {};
      
      // Cache des ordres d'achat actifs (clientOid -> { price, status })
      this.buyCurrentOrders = new Map();
      
      // Cache des ordres de vente actifs (price -> clientOid)
      this.sellCurrentOrders = new Map();
      
      // Cache des achats complétés en attente de vente (price -> details)
      this.buyFilledOrders = new Map();
      
      // Cache du dernier prix connu
      this.lastPrice = null;
      this.lastPriceTimestamp = null;
      
      // État de la persistance
      this.isSaving = false;
      this.saveIntervalId = null;
    }
    
    // Initialiser la persistance
    initPersistence() {
      if (!this.config.persistence || !this.config.persistence.enabled) {
        console.log("ℹ️ Persistance du cache désactivée");
        return;
      }
      
      // Créer le dossier de données si nécessaire
      const dir = path.dirname(this.config.persistence.cacheFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Dossier ${dir} créé pour le stockage du cache`);
      }
      
      // Charger le cache au démarrage
      this.loadFromFile();
      
      // Configurer la sauvegarde périodique
      const interval = this.config.persistence.cacheSaveInterval || 60 * 1000;
      this.saveIntervalId = setInterval(() => {
        this.saveToFile();
      }, interval);
      
      console.log(`✅ Persistance configurée: sauvegarde toutes les ${interval/1000} secondes`);
    }
    
    // Sauvegarde asynchrone
    saveToFile() {
      // Éviter les sauvegardes concurrentes
      if (this.isSaving) {
        return;
      }
      
      this.isSaving = true;
      
      try {
        // Préparer les données
        const cacheData = {
          version: 1,
          timestamp: Date.now(),
          buyCurrentOrders: [...this.buyCurrentOrders],
          sellCurrentOrders: [...this.sellCurrentOrders],
          buyFilledOrders: [...this.buyFilledOrders],
          lastPrice: this.lastPrice,
          lastPriceTimestamp: this.lastPriceTimestamp
        };
        
        // Écrire dans un fichier temporaire
        const tempPath = this.config.persistence.cacheFilePath + '.tmp';
        
        fs.writeFile(tempPath, JSON.stringify(cacheData), (err) => {
          if (err) {
            console.error('❌ Erreur lors de la sauvegarde du cache:', err);
            this.isSaving = false;
            return;
          }
          
          // Renommer le fichier (opération atomique)
          fs.rename(tempPath, this.config.persistence.cacheFilePath, (renameErr) => {
            if (renameErr) {
              console.error('❌ Erreur lors du renommage du fichier cache:', renameErr);
            } else {
              console.log(`💾 Cache sauvegardé (${this.buyCurrentOrders.size} ordres d'achat, ${this.sellCurrentOrders.size} ordres de vente)`);
            }
            this.isSaving = false;
          });
        });
      } catch (error) {
        console.error('❌ Exception lors de la sauvegarde du cache:', error);
        this.isSaving = false;
      }
    }
    
    // Chargement depuis un fichier
    loadFromFile() {
      if (!this.config.persistence || !this.config.persistence.cacheFilePath) {
        console.log('ℹ️ Aucun chemin de fichier cache configuré');
        return false;
      }
      
      if (!fs.existsSync(this.config.persistence.cacheFilePath)) {
        console.log('ℹ️ Aucun fichier cache trouvé, démarrage avec un cache vide');
        return false;
      }
      
      try {
        const data = fs.readFileSync(this.config.persistence.cacheFilePath, 'utf8');
        const cacheData = JSON.parse(data);
        
        // Charger les données dans les Maps
        this.buyCurrentOrders = new Map(cacheData.buyCurrentOrders);
        this.sellCurrentOrders = new Map(cacheData.sellCurrentOrders);
        this.buyFilledOrders = new Map(cacheData.buyFilledOrders);
        this.lastPrice = cacheData.lastPrice;
        this.lastPriceTimestamp = cacheData.lastPriceTimestamp;
        
        console.log(`✅ Cache chargé: ${this.buyCurrentOrders.size} ordres d'achat, ${this.sellCurrentOrders.size} ordres de vente, ${this.buyFilledOrders.size} ordres en attente`);
        return true;
      } catch (error) {
        console.error('❌ Erreur lors du chargement du cache:', error);
        return false;
      }
    }
    
    // Arrêter la persistance
    stopPersistence() {
      if (this.saveIntervalId) {
        clearInterval(this.saveIntervalId);
        this.saveIntervalId = null;
      }
      
      // Sauvegarde finale synchrone
      this.saveSyncAndWait();
    }
    
    // Sauvegarde synchrone pour l'arrêt
    saveSyncAndWait() {
      try {
        const cacheData = {
          version: 1,
          timestamp: Date.now(),
          buyCurrentOrders: [...this.buyCurrentOrders],
          sellCurrentOrders: [...this.sellCurrentOrders],
          buyFilledOrders: [...this.buyFilledOrders],
          lastPrice: this.lastPrice,
          lastPriceTimestamp: this.lastPriceTimestamp
        };
        
        fs.writeFileSync(this.config.persistence.cacheFilePath, JSON.stringify(cacheData));
        console.log('💾 Sauvegarde finale du cache effectuée');
        return true;
      } catch (error) {
        console.error('❌ Erreur lors de la sauvegarde finale:', error);
        return false;
      }
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
    addBuyOrder(clientOid, price, size) {
      this.buyCurrentOrders.set(clientOid, {
        price: price,
        size: size,
        status: 'pending',
        timestamp: Date.now()
      });
      console.log(`💾 Ajout au cache d'un ordre d'achat: ${clientOid} à ${price}$ pour ${size} BTC`);
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
    
    // Fonction de diagnostic pour analyser l'état actuel du cache
    diagnoseCacheState() {
      const currentPrice = this.lastPrice;
      console.log(`\n🔍 DIAGNOSTIC DU CACHE - Prix actuel: ${currentPrice}$`);
      
      // Afficher les ordres d'achat actifs
      console.log(`\n📊 ORDRES D'ACHAT ACTIFS (${this.buyCurrentOrders.size}):`);
      const buyOrders = [...this.buyCurrentOrders.entries()]
        .sort((a, b) => b[1].price - a[1].price); // Tri par prix décroissant
        
      buyOrders.forEach(([clientOid, orderInfo], index) => {
        const priceDiff = currentPrice - orderInfo.price;
        console.log(`  ${index+1}. ${clientOid}: ${orderInfo.price}$ (${orderInfo.status}) - Écart: ${priceDiff.toFixed(2)}$`);
      });
      
      // Afficher les ordres de vente actifs
      console.log(`\n📊 ORDRES DE VENTE ACTIFS (${this.sellCurrentOrders.size}):`);
      const sellOrders = [...this.sellCurrentOrders.entries()]
        .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])); // Tri par prix croissant
        
      sellOrders.forEach(([price, orderInfo], index) => {
        const clientOid = typeof orderInfo === 'string' ? orderInfo : orderInfo.clientOid;
        const status = typeof orderInfo === 'string' ? 'inconnu' : orderInfo.status;
        const priceDiff = parseFloat(price) - currentPrice;
        console.log(`  ${index+1}. ${clientOid}: ${price}$ (${status}) - Écart: ${priceDiff.toFixed(2)}$`);
      });
      
      // Afficher les ordres remplis en attente de vente
      console.log(`\n📊 ORDRES REMPLIS EN ATTENTE (${this.buyFilledOrders.size}):`);
      const filledOrders = [...this.buyFilledOrders.entries()]
        .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])); // Tri par prix croissant
        
      filledOrders.forEach(([price, details], index) => {
        console.log(`  ${index+1}. ${details.clientOid}: ${price}$ - Acheté à ${details.timestamp}`);
      });
      
      console.log("\n🔍 FIN DU DIAGNOSTIC DU CACHE\n");
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
    
    // Nettoyage des ordres pending trop anciens
    cleanPendingOrders(maxPendingTimeMs = 1500) {
      const now = Date.now();
      let removedCount = 0;
      
      console.log(`🧹 Nettoyage des ordres 'pending' plus anciens que ${maxPendingTimeMs}ms`);
      
      // Vérifier les ordres d'achat en attente
      for (const [clientOid, orderInfo] of this.buyCurrentOrders.entries()) {
        if (orderInfo.status === 'pending') {
          const pendingTime = now - orderInfo.timestamp;
          
          if (pendingTime > maxPendingTimeMs) {
            console.log(`⚠️ Ordre d'achat en attente expiré: ${clientOid} à ${orderInfo.price}$ (${pendingTime}ms)`);
            this.buyCurrentOrders.delete(clientOid);
            removedCount++;
          }
        }
      }
      
      // Vérifier les ordres de vente en attente
      for (const [price, orderInfo] of this.sellCurrentOrders.entries()) {
        if (typeof orderInfo !== 'string' && orderInfo.status === 'pending') {
          const pendingTime = now - orderInfo.timestamp;
          
          if (pendingTime > maxPendingTimeMs) {
            console.log(`⚠️ Ordre de vente en attente expiré: ${orderInfo.clientOid} à ${price}$ (${pendingTime}ms)`);
            this.sellCurrentOrders.delete(price);
            removedCount++;
          }
        }
      }
      
      if (removedCount > 0) {
        console.log(`🧹 ${removedCount} ordres 'pending' expirés ont été supprimés du cache`);
      } else {
        console.log(`✅ Aucun ordre 'pending' expiré trouvé`);
      }
      
      return removedCount;
    }
    
    // Nouvelle méthode pour obtenir les ordres d'achat actifs triés par distance
    getActiveBuyOrdersSortedByDistance(targetPrice) {
      return Array.from(this.buyCurrentOrders.entries())
        .filter(([_, order]) => order.status === 'live')  // Ne garder que les ordres 'live'
        .map(([clientOid, order]) => ({
          clientOid,
          price: order.price,
          size: order.size,
          status: order.status,
          timestamp: order.timestamp
        }))
        .sort((a, b) => {
          const distanceA = Math.abs(a.price - targetPrice);
          const distanceB = Math.abs(b.price - targetPrice);
          return distanceB - distanceA;  // Modifié pour avoir le plus éloigné en premier
        });
    }
  }
  
  module.exports = CacheManager;