// Download the helper library from https://www.twilio.com/docs/node/install
// Find your Account SID and Auth Token at twilio.com/console
// and set the environment variables. See http://twil.io/secure
require('dotenv').config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const urlBase = process.env.URL_BASE;
const twilio_number = process.env.TWILIO_NUMBER;
const client = require('twilio')(accountSid, authToken);
const fs = require('fs');
const cheerio = require("cheerio");
const axios = require('axios');
const app = require('./api');
const { Course } = require("./Course");


let courses = [];

try {
    let data = JSON.parse(fs.readFileSync('courses.json', 'utf-8'));
    for (const course of data) {
        courses.push(new Course(course.crn, course.numbers))
    }
} catch (e) {

}

app.get('/onboard', (req, res) => {
    let number = req.query.number;
    let crn = req.query.crn;
    if (!number || !crn) {
        res.status(400).send('Number and CRN are requered x-www-form-urlencoded fields');
        return;
    }
    try {
        let classIdx = courses.findIndex(course => course.crn == crn);
        if (classIdx < 0) {
            classIdx = courses.length;
            courses.push(
                new Course(crn, null)
            );
        }
        courses[classIdx].addNumber(number);
        res.send(`You are now subscribed to notifications for CRN ${crn}! Unsubscribe: ${urlBase + '/offboard?crn=' + crn + '&number=' + number}`);
        console.log('Added number ' + number + ' to CRN ' + crn);
        saveChanges();
        client.messages
        .create({
            body: `You are now subscribed to notifications for CRN ${crn}! Unsubscribe: ${urlBase + '/offboard?crn=' + crn + '&number=' + number}`,
            from: twilio_number,
            to: '+1' + number
        })
        .then(message => { });
    } catch (e) {
        res.status(500).send("Internal Server Error");
        console.error(e);
        return;
    }
});

app.get('/offboard', (req, res) => {
    let number = req.query.number;
    let crn = req.query.crn;
    let complete = req.query.complete;
    if (complete === undefined && crn === undefined) {
        res.status(400).send('Number and (CRN or complete) are requered x-www-form-urlencoded fields');
        return;
    }
    if (complete == 'true') {
        for (let courseObj of courses) {
            courseObj.removeNumber(number);
        }
        res.send("You have been removed from all course notifications");
        saveChanges();
        client.messages
        .create({
            body: `You have been unsubscribed from all course notifications!`,
            from: twilio_number,
            to: '+1' + number
        });
        console.log('Removed number ' + number + ' from all courses');
        return;
    }
    let courseIdx = courses.findIndex(course => course.crn == crn);
    if (courseIdx < 0) {
        res.status(403).send("A course with that CRN does not exist");
        return;
    }
    let course = courses[courseIdx];
    course.removeNumber(number);
    res.send(course.courseName + " has been removed from your notifications");
    saveChanges();
    client.messages
    .create({
        body: `You have been unsubscribed from ${course.courseName}! Subscribe: ${urlBase + '/onboard?crn=' + crn + '&number=' + number}`,
        from: twilio_number,
        to: '+1' + number
    });
    console.log('Removed number ' + number + ' from CRN ' + crn);
});

app.get('/get-courses', (req, res) => {
    let number = req.query.number;
    if (!number) {
        res.status(400).send('Number is a required x-www-form-urlencoded field');
        return;
    }
    let courseList = [];
    for (let course of courses) {
        if (course.numbers.find(num => num.number == number)) {
            courseList.push(course.courseName);
        }
    }
    res.send(courseList);
});

app.get('/get-all-notifiers', (req, res) => {
    let courseList = [];
    for (let course of courses) {
        let obj = {
            courseName: course.courseName,
            numbers: []
        }
        for (let number of course.numbers) {
            obj.numbers.push(number.number);
        }
        courseList.push(obj);
    }
    res.send(courseList);
});

function saveChanges() {
    fs.writeFileSync('courses.json', JSON.stringify(courses));
}

function updateCourseData() {
    for (let course of courses) {
        (async () => {
            try {
                let url = course.getUrl();
                let response = await axios.get(url);
                let $ = cheerio.load(response.data, null, false);
                let courseName = $('.ddlabel')[0].children[0].data;
                let seatsCap = $('.datadisplaytable')[1].children[2].children[1].children[3].children[0].data;
                let seatsActual = $('.datadisplaytable')[1].children[2].children[1].children[5].children[0].data
                let seatsRemaining = $('.datadisplaytable')[1].children[2].children[1].children[7].children[0].data
                let waitCap = $('.datadisplaytable')[1].children[2].children[3].children[3].children[0].data;
                let waitActual = $('.datadisplaytable')[1].children[2].children[3].children[5].children[0].data;
                let waitListRemaining = $('.datadisplaytable')[1].children[2].children[3].children[7].children[0].data;
                course.setData(courseName, seatsCap, seatsActual, seatsRemaining, waitCap, waitActual, waitListRemaining);

                if (waitListRemaining > 0) {
                    for (let number of course.numbers) {
                        if (Date.now() > number.nextNotifyWaitlist) {
                            client.messages
                                .create({
                                    body: `There is a waitlist spot in ${courseName}! Unsubscribe: ${urlBase + '/offboard?crn=' + course.crn + '&number=' + number.number}`,
                                    from: twilio_number,
                                    to: '+1' + number.number
                                })
                                .then(message => { });
                            number.updateNextNotifyWaitlist();
                        }
                    }
                }

                if (seatsRemaining > 0) {
                    for (let number of course.numbers) {
                        if (Date.now() > number.nextNotifySeats) {
                            client.messages
                                .create({
                                    body: `There is a seat available in ${courseName}! Unsubscribe: ${urlBase + '/offboard?crn=' + course.crn + '&number=' + number.number}`,
                                    from: twilio_number,
                                    to: '+1' + number.number
                                })
                                .then(message => { });
                            number.updateNextNotifySeats();
                        }
                    }
                }
            } catch (e) {
                console.error(e);
            }
        })()
    }
}

setInterval(updateCourseData, 30 * 1000);


