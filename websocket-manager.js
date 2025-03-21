// websocket-manager.js
const WebSocket = require('ws');
const crypto = require('crypto');
const EventEmitter = require('events');

class WebSocketManager extends EventEmitter {
  constructor(config, cacheManager) {
    super();
    this.config = config;
    this.cacheManager = cacheManager;
    this.publicWs = null;
    this.privateWs = null;
    this.publicConnected = false;
    this.privateConnected = false;
    this.isAuthenticated = false;
    this.messageQueue = [];
    this.publicPingInterval = null;
    this.privatePingInterval = null;
    this.publicReconnectAttempts = 0;
    this.privateReconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.publicScheduledReconnect = null;
    this.privateScheduledReconnect = null;
  }
  
  async connect() {
    try {
      await Promise.all([
        this.connectPublic(),
        this.connectPrivate()
      ]);
      this.startMessageProcessing();
      return true;
    } catch (error) {
      console.error('Erreur lors de la connexion aux WebSockets:', error);
      return false;
    }
  }
  
  async connectPublic() {
    return new Promise((resolve, reject) => {
      console.log(`🔌 Connexion au WebSocket public: ${this.config.wsEndpoints.public}`);
      
      this.publicWs = new WebSocket(this.config.wsEndpoints.public);
      
      this.publicWs.on('open', () => {
        console.log('✅ WebSocket public connecté');
        this.publicConnected = true;
        this.publicReconnectAttempts = 0;
        
        // S'abonner au canal ticker
        this.subscribeToPriceUpdates();
        
        // Configurer le ping/pong
        this.setupPublicPingPong();
        
        // Programmer une reconnexion
        this.schedulePublicReconnect();
        
        resolve();
      });
      
      this.publicWs.on('message', (message) => {
        try {
          // Traiter le ping/pong en texte brut
          if (message.toString() === 'pong') {
            console.log('📥 Pong reçu (public)');
            return;
          }
          
          const data = JSON.parse(message.toString());
          
          // Traiter les mises à jour de prix
          if (data.arg && data.arg.channel === 'ticker' && data.data && data.data.length > 0) {
            const price = parseFloat(data.data[0].lastPr);
            
            if (isNaN(price)) {
              console.error('❌ Prix invalide reçu:', data.data[0]);
              return;
            }
            
            const timestamp = new Date(parseInt(data.ts)).toISOString();
            console.log(`💰 Prix actuel de ${this.config.symbol}: ${price} USDT (${timestamp})`);
            
            this.cacheManager.updatePrice(price);
            this.emit('price_update', price);
          } else {
            // Autres types de messages
            console.log('📩 Message public reçu:', JSON.stringify(data).substring(0, 200));
          }
        } catch (error) {
          console.error('❌ Erreur de traitement du message public:', error.message);
        }
      });
      
      this.publicWs.on('error', (error) => {
        console.error(`❌ Erreur WebSocket public: ${error.message}`);
        this.publicConnected = false;
        reject(error);
      });
      
      this.publicWs.on('close', (code, reason) => {
        console.warn(`⚠️ WebSocket public déconnecté: Code=${code}, Raison=${reason || 'Non spécifiée'}`);
        this.publicConnected = false;
        
        // Nettoyer les intervalles
        if (this.publicPingInterval) {
          clearInterval(this.publicPingInterval);
          this.publicPingInterval = null;
        }
        
        if (this.publicScheduledReconnect) {
          clearTimeout(this.publicScheduledReconnect);
          this.publicScheduledReconnect = null;
        }
        
        // Tenter de se reconnecter
        this.reconnectPublic();
      });
    });
  }
  
  async connectPrivate() {
    return new Promise((resolve, reject) => {
      console.log(`🔌 Connexion au WebSocket privé: ${this.config.wsEndpoints.private}`);
      
      this.privateWs = new WebSocket(this.config.wsEndpoints.private);
      
      this.privateWs.on('open', () => {
        console.log('✅ WebSocket privé connecté');
        this.privateConnected = true;
        this.privateReconnectAttempts = 0;
        
        // S'authentifier
        this.authenticate();
        
        // Configurer le ping/pong
        this.setupPrivatePingPong();
        
        // Programmer une reconnexion
        this.schedulePrivateReconnect();
        
        resolve();
      });
      
      this.privateWs.on('message', (message) => {
        try {
          // Traiter le ping/pong en texte brut
          if (message.toString() === 'pong') {
            console.log('📥 Pong reçu (privé)');
            return;
          }
          
          const data = JSON.parse(message.toString());
          
          // Traiter l'événement de login
          if (data.event === 'login') {
            if (data.code === 0 || data.code === '0') {
              console.log('🔐 Authentification réussie');
              this.isAuthenticated = true;
              this.subscribeToOrderUpdates();
            } else {
              console.error(`❌ Échec de l'authentification: ${data.msg}`);
            }
            return;
          }
          
          // Traiter les mises à jour d'ordres
          if (data.arg && data.arg.channel === 'orders' && data.data && data.data.length > 0) {
            data.data.forEach(order => {
              const { clientOid, status, price, size, side } = order;
              
              if (!clientOid) {
                console.log('📋 Ordre sans clientOid reçu:', order);
                return;
              }
              
              console.log(`📋 Mise à jour d'ordre reçue: ${clientOid}, Statut: ${status}`);
              
              this.handleOrderUpdate(order);
              this.emit('order_update', order);
            });
          } else if (data.event === 'trade') {
            // Réponse de placement ou annulation d'ordre
            if (data.code === 0 || data.code === '0') {
              console.log(`✅ Action d'ordre réussie: ${data.arg[0].channel}`);
            } else {
              console.error(`❌ Échec de l'action d'ordre: ${data.msg}`);
            }
          } else if (data.event === 'error') {
            console.error(`❌ ERREUR API: Code ${data.code} - ${data.msg}`);
            console.error(`   Détails: ${JSON.stringify(data.arg)}`);
            
            // Si c'est une erreur d'annulation d'ordre
            if (data.code === 43001 && data.arg && data.arg[0] && data.arg[0].channel === 'cancel-order') {
              const clientOid = data.arg[0].params.clientOid;
              console.log(`   🧹 L'ordre ${clientOid} n'existe pas ou est déjà annulé, suppression du cache local`);
              
              // Supprimer l'ordre du cache s'il existe encore
              this.cacheManager.removeBuyOrder(clientOid);
            }
            
            return;
          } else {
            // Autres types de messages
            console.log('📩 Message privé reçu:', JSON.stringify(data).substring(0, 200));
          }
        } catch (error) {
          console.error('❌ Erreur de traitement du message privé:', error.message);
        }
      });
      
      this.privateWs.on('error', (error) => {
        console.error(`❌ Erreur WebSocket privé: ${error.message}`);
        this.privateConnected = false;
        this.isAuthenticated = false;
        reject(error);
      });
      
      this.privateWs.on('close', (code, reason) => {
        console.warn(`⚠️ WebSocket privé déconnecté: Code=${code}, Raison=${reason || 'Non spécifiée'}`);
        this.privateConnected = false;
        this.isAuthenticated = false;
        
        // Nettoyer les intervalles
        if (this.privatePingInterval) {
          clearInterval(this.privatePingInterval);
          this.privatePingInterval = null;
        }
        
        if (this.privateScheduledReconnect) {
          clearTimeout(this.privateScheduledReconnect);
          this.privateScheduledReconnect = null;
        }
        
        // Tenter de se reconnecter
        this.reconnectPrivate();
      });
    });
  }
  
  authenticate() {
    if (!this.privateConnected) {
      console.error('❌ WebSocket privé non connecté, impossible de s\'authentifier');
      return;
    }
    
    console.log('🔑 Authentification en cours...');
    
    const { apiKey, secretKey, passphrase } = this.config.apiKeys;
    const timestamp = Math.floor(Date.now() / 1000);
    
    // Message à signer
    const signMessage = timestamp + 'GET' + '/user/verify';
    
    // Générer la signature
    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(signMessage)
      .digest('base64');
    
    const authMessage = {
      op: 'login',
      args: [
        {
          apiKey: apiKey,
          passphrase: passphrase,
          timestamp: timestamp.toString(),
          sign: signature
        }
      ]
    };
    
    this.privateWs.send(JSON.stringify(authMessage));
  }
  
  subscribeToPriceUpdates() {
    if (!this.publicConnected) {
      console.error('❌ WebSocket public non connecté, impossible de s\'abonner au prix');
      return;
    }
    
    const subscribeMessage = {
      op: 'subscribe',
      args: [
        {
          instType: 'SPOT',
          channel: 'ticker',
          instId: this.config.symbol
        }
      ]
    };
    
    console.log(`📤 Abonnement au canal ticker pour ${this.config.symbol}`);
    this.publicWs.send(JSON.stringify(subscribeMessage));
  }
  
  subscribeToOrderUpdates() {
    if (!this.privateConnected || !this.isAuthenticated) {
      console.error('❌ WebSocket privé non connecté ou non authentifié, impossible de s\'abonner aux ordres');
      return;
    }
    
    const subscribeMessage = {
      op: 'subscribe',
      args: [
        {
          instType: 'SPOT',
          channel: 'orders',
          instId: this.config.symbol
        }
      ]
    };
    
    console.log(`📤 Abonnement au canal des ordres pour ${this.config.symbol}`);
    this.privateWs.send(JSON.stringify(subscribeMessage));
  }
  
  setupPublicPingPong() {
    this.publicPingInterval = setInterval(() => {
      if (this.publicConnected) {
        console.log('📤 Envoi de ping (public)');
        this.publicWs.send('ping');
        
        // Vérifier si on reçoit un pong dans les 5 secondes
        const pongTimeout = setTimeout(() => {
          console.warn('⚠️ Pas de pong reçu du WebSocket public, reconnexion...');
          if (this.publicWs) {
            this.publicWs.terminate();
          }
        }, 5000);
        
        // Fonction pour annuler le timeout quand on reçoit un pong
        const onPong = () => {
          clearTimeout(pongTimeout);
          this.publicWs.removeListener('message', pongHandler);
        };
        
        // Handler pour détecter le pong
        const pongHandler = (message) => {
          if (message.toString() === 'pong') {
            onPong();
          }
        };
        
        this.publicWs.on('message', pongHandler);
      }
    }, this.config.pingInterval);
  }
  
  setupPrivatePingPong() {
    this.privatePingInterval = setInterval(() => {
      if (this.privateConnected) {
        console.log('📤 Envoi de ping (privé)');
        this.privateWs.send('ping');
        
        // Vérifier si on reçoit un pong dans les 5 secondes
        const pongTimeout = setTimeout(() => {
          console.warn('⚠️ Pas de pong reçu du WebSocket privé, reconnexion...');
          if (this.privateWs) {
            this.privateWs.terminate();
          }
        }, 5000);
        
        // Fonction pour annuler le timeout quand on reçoit un pong
        const onPong = () => {
          clearTimeout(pongTimeout);
          this.privateWs.removeListener('message', pongHandler);
        };
        
        // Handler pour détecter le pong
        const pongHandler = (message) => {
          if (message.toString() === 'pong') {
            onPong();
          }
        };
        
        this.privateWs.on('message', pongHandler);
      }
    }, this.config.pingInterval);
  }
  
  schedulePublicReconnect() {
    this.publicScheduledReconnect = setTimeout(() => {
      console.log('⏰ Reconnexion programmée du WebSocket public déclenchée');
      this.reconnectPublic(true);
    }, this.config.reconnectInterval);
  }
  
  schedulePrivateReconnect() {
    this.privateScheduledReconnect = setTimeout(() => {
      console.log('⏰ Reconnexion programmée du WebSocket privé déclenchée');
      this.reconnectPrivate(true);
    }, this.config.reconnectInterval);
  }
  
  reconnectPublic(scheduled = false) {
    // Si c'est une reconnexion programmée, réinitialiser les tentatives
    if (scheduled) {
      this.publicReconnectAttempts = 0;
    }
    
    if (this.publicReconnectAttempts < this.maxReconnectAttempts) {
      this.publicReconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.publicReconnectAttempts), 30000);
      
      console.log(`🔄 Tentative de reconnexion du WebSocket public ${this.publicReconnectAttempts}/${this.maxReconnectAttempts} dans ${delay}ms`);
      
      setTimeout(() => {
        this.connectPublic().catch(error => {
          console.error('Échec de reconnexion du WebSocket public:', error);
        });
      }, delay);
    } else {
      console.error('❌ Nombre maximum de tentatives de reconnexion du WebSocket public atteint');
      
      // Réinitialiser les tentatives après un délai plus long
      setTimeout(() => {
        console.log('🔄 Réinitialisation des tentatives de reconnexion du WebSocket public');
        this.publicReconnectAttempts = 0;
        this.connectPublic().catch(error => {
          console.error('Échec de reconnexion du WebSocket public après réinitialisation:', error);
        });
      }, 60000);
    }
  }
  
  reconnectPrivate(scheduled = false) {
    // Si c'est une reconnexion programmée, réinitialiser les tentatives
    if (scheduled) {
      this.privateReconnectAttempts = 0;
    }
    
    if (this.privateReconnectAttempts < this.maxReconnectAttempts) {
      this.privateReconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.privateReconnectAttempts), 30000);
      
      console.log(`🔄 Tentative de reconnexion du WebSocket privé ${this.privateReconnectAttempts}/${this.maxReconnectAttempts} dans ${delay}ms`);
      
      setTimeout(() => {
        this.connectPrivate().catch(error => {
          console.error('Échec de reconnexion du WebSocket privé:', error);
        });
      }, delay);
    } else {
      console.error('❌ Nombre maximum de tentatives de reconnexion du WebSocket privé atteint');
      
      // Réinitialiser les tentatives après un délai plus long
      setTimeout(() => {
        console.log('🔄 Réinitialisation des tentatives de reconnexion du WebSocket privé');
        this.privateReconnectAttempts = 0;
        this.connectPrivate().catch(error => {
          console.error('Échec de reconnexion du WebSocket privé après réinitialisation:', error);
        });
      }, 60000);
    }
  }
  
  handleOrderUpdate(order) {
    // Afficher l'ordre complet pour le débogage
    console.log(`🔍 Mise à jour d'ordre reçue:`, JSON.stringify(order));
    
    const { clientOid, status, price, size, side } = order;
    
    if (!clientOid) {
      console.log(`⚠️ Mise à jour d'ordre sans clientOid:`, JSON.stringify(order));
      return;
    }
    
    const priceValue = parseFloat(price);
    const sizeValue = parseFloat(size);
    
    console.log(`📦 Traitement détaillé de l'ordre: ${clientOid}, Statut: ${status}, Prix: ${priceValue}, Taille: ${sizeValue}`);
    
    // Traitement des ordres d'achat
    if (clientOid.startsWith('buy_')) {
      console.log(`🔄 Traitement d'un ordre d'achat: ${clientOid} avec statut ${status}`);
      
      if (status === 'live') {
        this.cacheManager.updateOrderStatus(clientOid, 'live', 'buy');
      } else if (status === 'filled') {
        console.log(`✅ ORDRE D'ACHAT REMPLI: ${clientOid} à ${priceValue}$`);
        
        // Supprimer l'ordre du cache des ordres actifs
        this.cacheManager.removeBuyOrder(clientOid);
        
        // Ajouter l'ordre au cache des ordres remplis
        this.cacheManager.addFilledBuyOrder(priceValue, {
          orderId: order.orderId || 'unknown',
          clientOid: clientOid,
          price: priceValue,
          size: sizeValue,
          timestamp: Date.now()
        });
        
        // Émettre l'événement
        try {
          console.log(`🚀 ÉMISSION de l'événement buy_order_filled pour ${clientOid} à ${priceValue}$`);
          
          // Vérifier si nous avons des écouteurs pour cet événement
          const listenerCount = this.listenerCount('buy_order_filled');
          console.log(`📡 Nombre d'écouteurs pour buy_order_filled: ${listenerCount}`);
          
          // Émettre l'événement
          super.emit('buy_order_filled', { 
            price: priceValue, 
            clientOid: clientOid, 
            size: sizeValue,
            orderId: order.orderId || 'unknown'
          });
          
          console.log(`✅ Événement buy_order_filled émis avec succès`);
        } catch (error) {
          console.error(`❌ ERREUR lors de l'émission de l'événement buy_order_filled:`, error);
        }
      } else if (status === 'cancelled' || status === 'canceled') {
        this.cacheManager.removeBuyOrder(clientOid);
      }
    } 
    // Traiter les ordres de vente
    else if (clientOid.startsWith('sell_')) {
      if (status === 'filled') {
        // Ordre de vente exécuté
        const buyPrice = priceValue - this.config.priceStep;
        
        // Retirer l'ordre du cache des ventes et des achats remplis
        this.cacheManager.removeFilledBuyOrder(buyPrice);
        this.cacheManager.removeSellOrder(priceValue);
        
        this.emit('sell_order_filled', { 
          price: priceValue, 
          clientOid: clientOid, 
          size: sizeValue 
        });
      } else if (status === 'cancelled' || status === 'canceled') {
        // Ordre de vente annulé
        for (const [sellPrice, orderInfo] of this.cacheManager.sellCurrentOrders.entries()) {
          // Vérifier si orderInfo est une chaîne ou un objet
          const orderClientOid = typeof orderInfo === 'string' ? orderInfo : orderInfo.clientOid;
          
          if (orderClientOid === clientOid) {
            this.cacheManager.removeSellOrder(sellPrice);
            console.log(`✅ Ordre de vente ${clientOid} supprimé du cache à ${sellPrice}$`);
            break;
          }
        }
      }
    }
  }
  
  // Gestion des files d'attente pour le throttling
  startMessageProcessing() {
    // Intervalle pour envoyer les messages à la fréquence maximale autorisée
    setInterval(() => this.processMessageQueue(), 1000 / this.config.throttleRate);
  }
  
  queueMessage(message) {
    this.messageQueue.push(message);
  }
  
  processMessageQueue() {
    if (this.messageQueue.length === 0 || !this.privateConnected) return;
    
    const message = this.messageQueue.shift();
    
    try {
      this.privateWs.send(JSON.stringify(message));
    } catch (error) {
      console.error('Erreur lors de l\'envoi du message:', error);
      // Remettre le message dans la file si c'est une erreur temporaire
      if (error.code !== 'EPIPE' && error.code !== 'ECONNRESET') {
        this.messageQueue.unshift(message);
      }
    }
  }
  
  // Méthodes pour envoyer des ordres
  placeOrder(clientOid, side, price, size) {
    if (!this.privateConnected || !this.isAuthenticated) {
      console.error('WebSocket privé non connecté ou non authentifié, impossible de placer un ordre');
      return null;
    }
    
    const orderMessage = {
      op: 'trade',
      args: [
        {
          id: `trade-${Date.now()}`,
          instType: 'SPOT',
          instId: this.config.symbol,
          channel: 'place-order',
          params: {
            orderType: 'limit',
            side: side,
            size: size.toString(),
            price: price.toString(),
            force: 'gtc',
            clientOid: clientOid
          }
        }
      ]
    };
    
    console.log(`📤 Placement d'un ordre ${side} à ${price}$ (taille: ${size})`);
    this.queueMessage(orderMessage);
    
    return clientOid;
  }
  
  cancelOrder(clientOid) {
    if (!this.privateConnected || !this.isAuthenticated) {
      console.error('WebSocket privé non connecté ou non authentifié, impossible d\'annuler un ordre');
      return false;
    }
    
    const cancelMessage = {
      op: 'trade',
      args: [
        {
          id: `cancel-${Date.now()}`,
          instType: 'SPOT',
          instId: this.config.symbol,
          channel: 'cancel-order',
          params: {
            clientOid: clientOid
          }
        }
      ]
    };
    
    console.log(`📤 Annulation de l'ordre: ${clientOid}`);
    this.queueMessage(cancelMessage);
    
    return true;
  }
  
  // Méthode pour la fermeture propre
  disconnect() {
    console.log('🛑 Déconnexion des WebSockets');
    
    // Arrêter les reconnexions programmées
    if (this.publicScheduledReconnect) {
      clearTimeout(this.publicScheduledReconnect);
      this.publicScheduledReconnect = null;
    }
    
    if (this.privateScheduledReconnect) {
      clearTimeout(this.privateScheduledReconnect);
      this.privateScheduledReconnect = null;
    }
    
    // Arrêter les pings
    if (this.publicPingInterval) {
      clearInterval(this.publicPingInterval);
      this.publicPingInterval = null;
    }
    
    if (this.privatePingInterval) {
      clearInterval(this.privatePingInterval);
      this.privatePingInterval = null;
    }
    
    // Fermer les connexions
    if (this.publicWs) {
      this.publicWs.close();
      this.publicWs = null;
    }
    
    if (this.privateWs) {
      this.privateWs.close();
      this.privateWs = null;
    }
    
    this.publicConnected = false;
    this.privateConnected = false;
    this.isAuthenticated = false;
    
    console.log('👋 WebSockets déconnectés proprement');
  }
  
  // Méthode pour placer des ordres en masse
  placeBulkOrders(orders) {
    if (!this.privateConnected || !this.isAuthenticated) {
      console.error('❌ WebSocket privé non connecté ou non authentifié, impossible de placer des ordres en masse');
      return 0;
    }
    
    let ordersPlaced = 0;
    
    for (const order of orders) {
      const { clientOid, side, price, size } = order;
      
      const orderMessage = {
        op: 'trade',
        args: [
          {
            id: `trade-${Date.now()}-${ordersPlaced}`,
            instType: 'SPOT',
            instId: this.config.symbol,
            channel: 'place-order',
            params: {
              orderType: 'limit',
              side: side,
              size: size.toString(),
              price: price.toString(),
              force: 'gtc',
              clientOid: clientOid
            }
          }
        ]
      };
      
      try {
        // Envoi direct sans file d'attente pour les ordres en masse
        this.privateWs.send(JSON.stringify(orderMessage));
        ordersPlaced++;
      } catch (error) {
        console.error(`❌ Erreur lors de l'envoi de l'ordre ${clientOid}:`, error);
      }
    }
    
    console.log(`📤 ${ordersPlaced}/${orders.length} ordres en masse envoyés directement`);
    return ordersPlaced;
  }
  
  // Méthode pour annuler des ordres en masse
  cancelBulkOrders(clientOids) {
    if (!this.privateConnected || !this.isAuthenticated) {
      console.error('❌ WebSocket privé non connecté ou non authentifié, impossible d\'annuler des ordres en masse');
      return 0;
    }
    
    let cancelRequests = 0;
    
    for (const clientOid of clientOids) {
      const cancelMessage = {
        op: 'trade',
        args: [
          {
            id: `cancel-${Date.now()}-${cancelRequests}`,
            instType: 'SPOT',
            instId: this.config.symbol,
            channel: 'cancel-order',
            params: {
              clientOid: clientOid
            }
          }
        ]
      };
      
      try {
        // Envoi direct sans file d'attente pour les annulations en masse
        this.privateWs.send(JSON.stringify(cancelMessage));
        cancelRequests++;
      } catch (error) {
        console.error(`❌ Erreur lors de l'annulation de l'ordre ${clientOid}:`, error);
      }
    }
    
    console.log(`🧹 ${cancelRequests}/${clientOids.length} demandes d'annulation en masse envoyées directement`);
    return cancelRequests;
  }
}

module.exports = WebSocketManager;