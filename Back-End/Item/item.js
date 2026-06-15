class Item{
    constructor(machineID, name, cost, slot ,
        purchases, stock, 
        expiryDate, lastRestocked){

        this.id = null; // firbase will generate this ID 

        this.machineID = machineID;
        this.name = name;
        this.cost = cost;
        this.slot = slot;
        this.purchases = purchases;
        this.stock = stock;
        this.expiryDate = expiryDate;
        this.lastRestocked = lastRestocked;
    }

    getInventory(){
        return this.purchases + this.stock; // calculates the inventory of the item 
    }

    toFirestore(){
        return{
            machineID: this.machineID,
            name: this.name,
            cost: this.cost,
            slot: this.slot,
            purchases: this.purchases,
            stock: this.stock,
            expiryDate: this.expiryDate,
            lastRestocked: this.lastRestocked
        };
    }

    static fromFireStore(doc){
        const data = doc.data();
        const item = new Item(
            data.machineID,
            data.name,
            data.cost,
            data.slot,
            data.purchases,
            data.stock,
            data.expiryDate,
            data.lastRestocked
        );
        item.id = doc.id;
        return item;
    }
}

module.exports = Item;