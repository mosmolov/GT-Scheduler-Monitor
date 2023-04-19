const currentTerm = '202308';

class NumberNotifier {
    constructor(number) {
        this.number = number;
        this.nextNotifyWaitlist = 0; // new Date(Date.now() + 5 * 60 * 1000);
        this.nextNotifySeats = new Date(Date.now() + 5 * 60 * 1000);
    }

    updateNextNotifyWaitlist() {
        this.nextNotifyWaitlist = new Date(Date.now() + 30 * 60 * 1000);
    }

    updateNextNotifySeats() {
        this.nextNotifySeats = new Date(Date.now() + 30 * 60 * 1000);
    }
}

class Course {
    constructor(crn, numbers) {
        this.crn = crn;
        this.numbers = [];

        if (numbers != null) {
            for (let number of numbers) {
                this.numbers.push(new NumberNotifier(number.number));
            }
        }
    }

    addNumber(number) {
        if (this.numbers.findIndex(num => num == number) < 0)
            this.numbers.push(new NumberNotifier(number));
    }

    removeNumber(number) {
        this.numbers = this.numbers.filter(num => num.number != number);
    }

    getUrl() {
        return `https://gt-scheduler.azurewebsites.net/proxy/class_section?term=${currentTerm}&crn=` + this.crn;
    }

    setData(courseName, seatsCap, seatsActual, seatsRemaining, waitCap, waitActual, waitRemaining) {
        this.courseName = courseName;
        this.seatsCap = seatsCap;
        this.seatsActual = seatsActual;
        this.seatsRemaining = seatsRemaining;
        this.waitCap = waitCap;
        this.waitActual = waitActual;
        this.waitRemaining = waitRemaining;
    }
}

exports.Course = Course;
