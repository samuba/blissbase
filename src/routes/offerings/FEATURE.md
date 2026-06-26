offerings are 1:1 sessions, or other (paid) services that users can offer to the community.

# offerings list
on /offerings users can filter offerings by location (same LocationDistanceInput as events) and keyword search. Filter state is reflected in the URL (`lat`, `lng`, `distance`, `plzCity`, `searchTerm`). On first visit without URL params, saved location cookie is used once and synced into the URL.
Offerings are listed as cards with the authors profile image and name showing inside the card, the card should have the title of the offering at the top and a small 3 lines preview of the description.
When user clicks the card the offering shows as a dialog, same way as EventDetailsDialog.
All offering data for the selected place are loaded in the beginning, the dialog should not load more data.

# creating offerings
on /offerings/new a user can create a new offering. It is one form that uses sveltekit remote functions form to create the offering on the server.
The fields are:
title
description (richtext via editorjs)
attendance (offline, online, offline and online)

if user is not logged in there will be also a email field at the bottom. The email field will use the email otp flow to login/register the user via email code  before the offering is being created.
the otp input should be in a small dialog, and the dialog should state that user has to enter the code in order for the offering to be created.
If the user is already logged in the offering gets created straight away.

If the users profile does not have the following fields defined (or user is not signed in), they will also be shown at the end of the offerings form to be filled out, and written to the profile on submition (or on successful otp verification):
profile name
profile image
profile banner image
profile description 
profile current location via Google Maps autocomplete (latitude, longitude, location label on profile). If no location is set, show a warning that only online offerings will be findable.
profile social links. Use same controls as in public profile page, maybe create shared components if required. User has to have at least one social link so seekers can actually talk to them.

At the top of the offerings list there is a "Add Offering" button. At the bottom of the list there is a inviting link to checkout events which links to /p/hoi-an or /p/danang depending on what user selected  for filtering the offerings. And a add your 

# create screen
/new should show two big buttons with a little sentence underneath clarifying what it is: Create Event, Create Offering. Create offering is a link to /offerings/new. Create Event will show the already existing event creation flow.