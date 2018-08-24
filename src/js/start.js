import 'whatwg-fetch';
import loadList from './load-list';
import tidyList from './tidy-list';
import drawDays from './draw-days';
import DBHandler from './db-handler';

const dbHandler = new DBHandler();

dbHandler.getAllData()
	.then(drawDays);

const fetchVendors = loadList()
	.then(tidyList);

fetchVendors.then(drawDays);
fetchVendors.then(dbHandler.saveData);
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('sw.js').then(function(registration) {
      // Registration was successful
      console.log('ServiceWorker registration successful with scope: ', registration.scope);
    }, function(err) {
      // registration failed :(
      console.log('ServiceWorker registration failed: ', err);
    });
  });
}
