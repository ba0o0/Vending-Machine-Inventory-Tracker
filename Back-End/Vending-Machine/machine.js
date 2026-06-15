class Machine{
    constructor(location, columns, rows, lastRestocked){

        this.id = null; // firbase will generate this ID 

        this.location = location;
        this.columns = columns;
        this.rows = rows;
        this.lastRestocked = lastRestocked;
    }

    getTotalSlots(){
        return this.rows * this.columns; // calculates total amount of slots 
    }

    toFirestore(){
        return{
            location: this.location,
            columns: this.columns,
            rows: this.rows,
            lastRestocked: this.lastRestocked
        };
    }

    static fromFireStore(doc){
        const data = doc.data();
        const machine = new Machine(
            data.location,
            data.columns,
            data.rows,
            data.lastRestocked
        );
        machine.id = doc.id;
        return machine;
    }

}
module.exports = Machine; 
