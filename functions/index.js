const functions = require('firebase-functions');
const firebase = require('firebase-admin');
firebase.initializeApp(functions.config().firebase);

//
exports.clearOldPosts = functions.https.onRequest((request, response) => {
	firebase.database().ref('posts').once('value', snap => {
		snap.forEach(post => {
			response.write(post.key + '\n');
		});
		response.end();
	});
});

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
