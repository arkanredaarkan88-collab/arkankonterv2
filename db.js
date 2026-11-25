/**
 * ============================================================================
 * ARKAN KONTER — MODUL DATABASE LOKAL (IndexedDB 100% OFFLINE)
 * ============================================================================
 */

const DB_NAME = 'ArkanKonterDB_V2';
const DB_VERSION = 1;

const DEFAULT_WALLETS = [
  { id: 'dana', name: 'Saldo Utama DANA', shortName: 'DANA', balance: 0, isPrimary: true, isCash: false, order: 1 },
  { id: 'cash', name: 'Tunai Laci', shortName: 'Tunai Laci', balance: 0, isPrimary: false, isCash: true, order: 2 },
  { id: 'ovo', name: 'OVO', shortName: 'OVO', balance: 0, isPrimary: false, isCash: false, order: 3 },
  { id: 'gopay', name: 'GoPay', shortName: 'GoPay', balance: 0, isPrimary: false, isCash: false, order: 4 },
  { id: 'shopeepay', name: 'ShopeePay', shortName: 'ShopeePay', balance: 0, isPrimary: false, isCash: false, order: 5 },
  { id: 'linkaja', name: 'LinkAja', shortName: 'LinkAja', balance: 0, isPrimary: false, isCash: false, order: 6 },
  { id: 'bank', name: 'Rek. Bank', shortName: 'Rek. Bank', balance: 0, isPrimary: false, isCash: false, order: 7 }
];

class ArkanDB {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains('wallets')) {
          const walletStore = db.createObjectStore('wallets', { keyPath: 'id' });
          DEFAULT_WALLETS.forEach((w) => walletStore.put(w));
        }

        if (!db.objectStoreNames.contains('transactions')) {
          const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
          txStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('debts')) {
          const debtStore = db.createObjectStore('debts', { keyPath: 'id' });
          debtStore.createIndex('customerKey', 'customerKey', { unique: false });
          debtStore.createIndex('status', 'status', { unique: false });
        }
      };

      request.onsuccess = async (event) => {
        this.db = event.target.result;
        const existingWallets = await this.getAll('wallets');
        if (existingWallets.length === 0) {
          for (const w of DEFAULT_WALLETS) {
            await this.put('wallets', w);
          }
        }
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  getAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  getById(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  put(storeName, item) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(item);
      req.onsuccess = () => resolve(item);
      req.onerror = () => reject(req.error);
    });
  }

  delete(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  clearStore(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async exportBackupData() {
    const [wallets, transactions, debts] = await Promise.all([
      this.getAll('wallets'),
      this.getAll('transactions'),
      this.getAll('debts')
    ]);
    return {
      appName: 'Arkan Konter',
      version: 2,
      exportedAt: new Date().toISOString(),
      wallets,
      transactions,
      debts
    };
  }

  async importBackupData(payload) {
    if (!payload || !Array.isArray(payload.wallets) || !Array.isArray(payload.transactions)) {
      throw new Error('Format file backup JSON tidak valid.');
    }
    await this.clearStore('wallets');
    await this.clearStore('transactions');
    await this.clearStore('debts');

    for (const w of payload.wallets) {
      await this.put('wallets', w);
    }
    for (const t of payload.transactions) {
      await this.put('transactions', t);
    }
    if (Array.isArray(payload.debts)) {
      for (const d of payload.debts) {
        await this.put('debts', d);
      }
    }
  }
}

window.arkanDB = new ArkanDB();
