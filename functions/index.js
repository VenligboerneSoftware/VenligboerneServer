const functions = require('firebase-functions');
const firebase = require('firebase-admin');
firebase.initializeApp(functions.config().firebase);

// This is an automatic maintence script that deletes posts which have
// expired. It is run regularly by a cron job at
// https://www.setcronjob.com/
// If a post has a scheduled date, it is deleted 3 days after that date.
// If a post has no scheduled date, it is deleted 30 days after creation.
exports.clearOldPosts = functions.https.onRequest((request, response) => {
	const ONE_DAY = 24 * 60 * 60 * 1000;

	firebase.database().ref('posts').once('value', snap => {
		snap.forEach(post => {
			response.write(
				post.key + ', ' + post.val().datetime + ', ' + post.val().creationTime
			);
			if (post.val().datetime) {
				if (Date.now() - post.val().datetime > ONE_DAY * 3) {
					response.write('  This should be deleted (already happened)');
					deletePost(post.key);
				}
			} else if (post.val().creationTime) {
				if (Date.now() - post.val().creationTime > ONE_DAY * 30) {
					response.write('  This should be deleted (too old)');
					deletePost(post.key);
				}
			} else {
				response.write(
					'  This post has no datetime or creationTime. Should it be deleted?'
				);
			}

			response.write('\n');
		});
		response.end();
	});
});

function deletePost(id) {
	// TODO delete the post, all of its applications, and all references to the
	// applications in their applicants' user objects
}

exports.refreshIndices = functions.https.onRequest((request, response) => {
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
			response.write(
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

					response.write(
						'Adding new application and indices: ' +
							JSON.stringify(updatePacket) +
							'\n'
					);
					firebase.database().ref().update(updatePacket);
				}
			});
	});

	setTimeout(function() {
		response.end();
	}, 10000);
});

exports.getSubscribers = functions.https.onRequest((request, response) => {
	response.write(
		'You want the subscribers for the application: ' + JSON.stringify(request)
	);

	response.end();
});
