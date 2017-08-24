const firebase = require('firebase-admin');
const functions = require('firebase-functions');
const geolib = require('geolib');

firebase.initializeApp(functions.config().firebase);

// This is an automatic maintence script that deletes posts which have
// expired. It is run regularly by a cron job at
// https://www.setcronjob.com/
// If a post has a scheduled date, it is deleted 3 days after that date.
// If a post has no scheduled date, it is deleted 30 days after creation.
exports.clearOldPosts = functions.https.onRequest((request, response) => {
	response.send('Clearing old posts...');
	const ONE_DAY = 24 * 60 * 60 * 1000;

	firebase.database().ref('posts').once('value', snap => {
		snap.forEach(post => {
			console.log(post.key, post.val().dates, post.val().creationTime);
			if (post.val().dates) {
				const lastDate = Math.max.apply(null, post.val().dates);
				console.log('Latest date', lastDate);
				if (Date.now() - lastDate > ONE_DAY * 3) {
					console.log(post.key, 'This should be deleted (already happened)');
					deletePost(post);
				}
			} else if (post.val().creationTime) {
				if (Date.now() - post.val().creationTime > ONE_DAY * 30) {
					console.log(post.key, 'This should be deleted (too old)');
					deletePost(post);
				}
			} else {
				console.log(
					post.key,
					'This post has no dates or creationTime. Should it be deleted?'
				);
			}
		});
	});
});

// Delete the post, all of its applications, and all references to the
// applications in their applicants' user objects
function deletePost(post) {
	if (post.hasChild('applications')) {
		Object.keys(post.val().applications).forEach(function(key) {
			firebase
				.database()
				.ref('applications')
				.child(key)
				.once('value')
				.then(function(snapshot) {
					const applicant = snapshot.val().applicant;
					console.log('remove application', key);
					// Remove the application
					firebase.database().ref('applications').child(key).remove();

					console.log('remove user index', applicant, key);
					// Remove the user index to the application
					firebase
						.database()
						.ref('users')
						.child(applicant)
						.child('applications')
						.child(key)
						.remove();
				});
		});
	}
	console.log('remove post ' + post.key + '\n');
	post.ref.remove();
}

exports.refreshIndices = functions.https.onRequest((request, response) => {
	response.send('Refreshing indices...');

	// Clear old indices
	firebase.database().ref('posts').on('child_added', snap => {
		snap.ref.child('applications').remove();
	});

	firebase.database().ref('users').on('child_added', snap => {
		snap.ref.child('applications').remove();
	});

	// Add new indices
	firebase.database().ref('applications').on('child_added', applicationSnap => {
		const key = applicationSnap.key;
		let application = applicationSnap.val();
		if (!application.post) {
			console.log(
				'Incomplete application: ' + JSON.stringify(application) + '\n'
			);
			// Incomplete application. Remove it.
			applicationSnap.ref.remove();
			return;
		}

		firebase
			.database()
			.ref('posts')
			.child(application.post)
			.once('value', snap => {
				if (!snap.exists()) {
					// The post this application was to is gone. Delete the application
					applicationSnap.ref.remove();
				} else {
					let updatePacket = {};

					// Add the application's ID to the user who is submitting it
					updatePacket[
						'users/' + application.applicant + '/applications/' + key
					] = true;

					// Add the application's ID to the post it is being submitted on
					updatePacket[
						'posts/' + application.post + '/applications/' + key
					] = true;

					console.log('Adding new application and indices', updatePacket);
					firebase.database().ref().update(updatePacket);
				}
			});
	});
});

exports.getSubscribers = functions.https.onRequest((request, response) => {
	const params = JSON.parse(request.body);
	const newPost = params.post;
	const userID = params.userID;
	console.log('request', newPost, userID);
	firebase.database().ref('subscriptions').once('value', subs => {
		console.log('Loaded subscriptions ', subs.val());
		let tokens = [];
		// Iterate over each user
		subs.forEach(userSubs => {
			// For each user, iterate over their subscriptions
			userSubs.forEach(subscription => {
				const sub = subscription.val();
				console.log('Checking sub', sub, newPost);
				// Get the push token if the subscription covers this post
				// Otherwise return null
				if (
					geolib.getDistance(sub, newPost) < sub.radius * 1000 &&
					sub.icon === newPost.icon &&
					userSubs.key !== userID // Don't let users notify themselves
				) {
					console.log('This subscription meets criteria', sub);
					tokens.push(
						firebase
							.database()
							.ref('users')
							.child(userSubs.key)
							.child('pushToken')
							.once('value')
					);
				}
			});
		});

		Promise.all(tokens).then(tokens => {
			tokens = tokens.map(token => token.val());

			// Notify all of the users who match the subscription
			console.log('Notifying ', tokens, ' of this new post ', newPost);
			// TODO notify directly from server instead of returning to client
			// Requires Blaze plan
			response.send(JSON.stringify(tokens));
		});
	});
});
