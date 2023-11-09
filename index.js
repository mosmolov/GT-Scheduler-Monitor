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
let crnMapping;
const currentTerm = '202308';

let axiosErrorCount = 0;
let courses = [];
let whitelist = [];

try {
    let data = JSON.parse(fs.readFileSync('courses.json', 'utf-8'));
    for (const course of data) {
        courses.push(new Course(course.crn, course.numbers))
    }
    console.log('Loaded ' + courses.length + ' courses from file');

    let whitelistData = JSON.parse(fs.readFileSync('whitelist.json', 'utf-8'));
    for (const number of whitelistData) {
        whitelist.push(number);
    }
    console.log('Loaded ' + whitelist.length + ' numbers from file');
} catch (e) {

}

app.get('/onboard', (req, res) => {
    let number = req.query.number;
    let crn = req.query.crn;
    let justSeats = req.query.justseats === 'true';
    let justWaitlist = req.query.justwaitlist === 'true';

    if (!whitelist.includes(number)) {
        res.status(403).send('You are not whitelisted to use this service');
        return;
    }

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
        courses[classIdx].addNumber(number, justSeats, justWaitlist);
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
            if (courseObj.numbers.length == 0) {
                courses = courses.filter(c => c.crn != courseObj.crn);
            }
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
    if (course.numbers.length == 0) {
        courses = courses.filter(c => c.crn != course.crn);
    }
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
    if (!whitelist.includes(number)) {
        res.status(403).send('You are not whitelisted to use this service');
        return;
    }
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
            crn: course.crn,
            numbers: []
        }
        for (let number of course.numbers) {
            obj.numbers.push({
                number: number.number,
                seatNotify: number.justSeats,
                waitlistNotify: number.justWaitlist
            });
        }
        courseList.push(obj);
    }
    res.send(courseList);
});

app.get('/whitelistAdd', (req, res) => {
    let number = req.query.number;
    if (!number) {
        res.status(400).send('Number is a required x-www-form-urlencoded field');
        return;
    }
    if (whitelist.includes(number)) {
        res.status(400).send('Number already whitelisted');
        return;
    }
    whitelist.push(number);
    res.send('Number ' + number + ' has been whitelisted');
    saveChanges();
});

app.get('/whitelistRemove', (req, res) => {
    let number = req.query.number;
    if (!number) {
        res.status(400).send('Number is a required x-www-form-urlencoded field');
        return;
    }
    if (!whitelist.includes(number)) {
        res.status(400).send('Number not whitelisted');
        return;
    }
    whitelist = whitelist.filter(num => num != number);
    res.send('Number ' + number + ' has been removed from the whitelist');
    saveChanges();
});

function saveChanges() {
    fs.writeFileSync('courses.json', JSON.stringify(courses));
    fs.writeFileSync('whitelist.json', JSON.stringify(whitelist));
}

function updateCourseData() {
    for (let course of courses) {
        (async () => {
            try {
                let url = course.getUrl();
                let response = await axios.get(url);
                let $ = cheerio.load(response.data, null, false);
                let courseName = crnMapping.get(course.crn);
                let sectionChildren = $('section').children();
                let dataValues = sectionChildren.map((i, el) => {
                    return el?.firstChild?.data
                })
                let seatsCap = dataValues[3];
                let seatsActual = dataValues[1];
                let seatsRemaining = dataValues[5];
                let waitCap = dataValues[7];
                let waitActual = dataValues[9];
                let waitListRemaining = dataValues[11];
                course.setData(courseName, seatsCap, seatsActual, seatsRemaining, waitCap, waitActual, waitListRemaining);

                if (waitListRemaining > 0) {
                    for (let number of course.numbers) {
                        if (Date.now() > number.nextNotifyWaitlist && number.justWaitlist) {
                            client.messages
                                .create({
                                    body: `There is a waitlist spot in ${courseName}! Unsubscribe: ${urlBase + '/offboard?crn=' + course.crn + '&number=' + number.number}`,
                                    from: twilio_number,
                                    to: '+1' + number.number
                                })
                                .then(message => { });
                            number.updateNextNotifyWaitlist();
                            console.log('Sent waitlist notification for ' + number.number + ' in ' + courseName);
                        }
                    }
                }

                if (seatsRemaining > 0) {
                    for (let number of course.numbers) {
                        if (Date.now() > number.nextNotifySeats && number.justSeats) {
                            client.messages
                                .create({
                                    body: `There is a seat available in ${courseName}! Unsubscribe: ${urlBase + '/offboard?crn=' + course.crn + '&number=' + number.number}`,
                                    from: twilio_number,
                                    to: '+1' + number.number
                                })
                                .then(message => { });
                            number.updateNextNotifySeats();
                            console.log('Sent seat notification for ' + number.number + ' in ' + courseName);
                        }
                    }
                }
            } catch (e) {
                if (e instanceof axios.AxiosError) {
                    axiosErrorCount++;
                    if (axiosErrorCount % 10 == 0) {
                        console.error('Axios error count: ' + axiosErrorCount);
                    }
                } else
                    console.error(e);
            }
        })()
    }
}

async function getMapping() {
    let response = await axios.get(`https://gt-scheduler.github.io/crawler-v2/${currentTerm}.json`)
    let data = response.data;
    let courses = data.courses;

    const mapping = new Map();

    for (const courseCode in courses) {
        const course = courses[courseCode];
        const courseName = course[0];
        for (const sectionLetter in course[1]) {
            const section = course[1][sectionLetter];
            mapping.set(section[0], `${sectionLetter} - ${courseName}`);
        }
    }

    crnMapping = mapping;
}

getMapping();
setInterval(updateCourseData, 30 * 1000);