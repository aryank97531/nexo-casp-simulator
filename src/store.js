/**
 * In-memory transaction store
 */
class TransactionStore {
  constructor() {
    this.transactions = [];
    this.messages = [];
    this.maxMessages = 500;
  }

  addTransaction(tx) {
    this.transactions.push({
      id: this.transactions.length + 1,
      timestamp: new Date().toISOString(),
      ...tx,
    });
    return this.transactions[this.transactions.length - 1];
  }

  addMessage(msg) {
    this.messages.push({
      id: this.messages.length + 1,
      timestamp: new Date().toISOString(),
      ...msg,
    });
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }
    return this.messages[this.messages.length - 1];
  }

  getTransactions(limit = 50) {
    return this.transactions.slice(-limit).reverse();
  }

  getMessages(limit = 100) {
    return this.messages.slice(-limit).reverse();
  }

  clear() {
    this.transactions = [];
    this.messages = [];
  }
}

module.exports = { TransactionStore };
